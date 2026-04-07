"""Scenario generator: produces ranked coproduction financing scenarios.

Key design principles:
- ALWAYS returns scenarios — never an empty list
- Scenarios requiring fewest changes from the user's current setup come first
- "Stretch" scenarios (requiring major restructuring) are included but ranked lower
- Every country with incentive data is a candidate, not just shoot countries
"""
from __future__ import annotations

from itertools import combinations
from sqlalchemy.orm import Session
from app.models import Incentive, Treaty, MultilateralMember, DocumentAnnotation
from app.schemas import (
    ProjectInput,
    Scenario,
    CoproductionPartner,
    EligibleIncentive,
    NearMiss,
    Requirement,
    Suggestion,
    TreatyInfo,
    SourceReference,
    DocumentReference,
)
from app.rule_engine import check_incentive_eligibility, check_near_miss, _percent_in_country
from app import countries


def _build_doc_lookup(db: Session) -> tuple[dict[int, list[DocumentAnnotation]], dict[int, list[DocumentAnnotation]]]:
    """Build lookups: incentive_id -> annotations, treaty_id -> annotations."""
    annotations = db.query(DocumentAnnotation).order_by(DocumentAnnotation.sort_order).all()
    by_incentive: dict[int, list[DocumentAnnotation]] = {}
    by_treaty: dict[int, list[DocumentAnnotation]] = {}
    for a in annotations:
        if a.incentive_id:
            by_incentive.setdefault(a.incentive_id, []).append(a)
        if a.treaty_id:
            by_treaty.setdefault(a.treaty_id, []).append(a)
    return by_incentive, by_treaty


def _first_doc_ref(anns: list[DocumentAnnotation]) -> DocumentReference:
    """Return a DocumentReference pointing to the first annotation."""
    return DocumentReference(document_id=anns[0].document_id, annotation_id=anns[0].id)


def _get_incentives_by_country(db: Session) -> dict[str, list[Incentive]]:
    """Group incentives by country code."""
    incentives = db.query(Incentive).all()
    by_country: dict[str, list[Incentive]] = {}
    for inc in incentives:
        key = inc.country_code.upper()
        by_country.setdefault(key, []).append(inc)
    return by_country


def _pair_key(code_a: str, code_b: str) -> tuple[str, str]:
    """Return a normalized treaty pair key."""
    a, b = code_a.upper(), code_b.upper()
    return (a, b) if a <= b else (b, a)


def _build_treaty_lookups(db: Session) -> tuple[dict[tuple[str, str], list[Treaty]], dict[str, list[str]]]:
    """Precompute treaty pair and partner lookups to avoid repeated DB queries."""
    treaties = db.query(Treaty).filter(Treaty.is_active == True).all()
    members = db.query(MultilateralMember).all()

    members_by_treaty: dict[int, list[str]] = {}
    for member in members:
        members_by_treaty.setdefault(member.treaty_id, []).append(member.country_code.upper())

    treaties_by_pair: dict[tuple[str, str], list[Treaty]] = {}
    partner_sets: dict[str, set[str]] = {}

    def add_pair(code_a: str, code_b: str, treaty: Treaty) -> None:
        a, b = code_a.upper(), code_b.upper()
        treaties_by_pair.setdefault(_pair_key(a, b), []).append(treaty)
        partner_sets.setdefault(a, set()).add(b)
        partner_sets.setdefault(b, set()).add(a)

    for treaty in treaties:
        if treaty.treaty_type == "bilateral" and treaty.country_b_code:
            add_pair(treaty.country_a_code, treaty.country_b_code, treaty)
            continue

        member_codes = sorted(set(members_by_treaty.get(treaty.id, [])))
        for code_a, code_b in combinations(member_codes, 2):
            add_pair(code_a, code_b, treaty)

    partners_by_country = {
        code: sorted(partners)
        for code, partners in partner_sets.items()
    }
    return treaties_by_pair, partners_by_country


def _get_treaties_for_pair(
    treaties_by_pair: dict[tuple[str, str], list[Treaty]],
    code_a: str,
    code_b: str,
) -> list[Treaty]:
    """Find treaties between two countries from the precomputed lookup."""
    return treaties_by_pair.get(_pair_key(code_a, code_b), [])


def _get_all_treaty_partners(partners_by_country: dict[str, list[str]], code: str) -> list[str]:
    """All countries that have a treaty relationship with the given country."""
    return partners_by_country.get(code.upper(), [])


def _treaty_to_info(
    treaty: Treaty,
    doc_by_treaty: dict[int, list[DocumentAnnotation]] | None = None,
) -> TreatyInfo:
    """Convert a Treaty ORM object to a TreatyInfo schema."""
    authorities = []
    if treaty.competent_authority_a:
        authorities.append(treaty.competent_authority_a)
    if treaty.competent_authority_b:
        authorities.append(treaty.competent_authority_b)
    doc_ref = None
    if doc_by_treaty:
        anns = doc_by_treaty.get(treaty.id)
        if anns:
            doc_ref = _first_doc_ref(anns)
    source = None
    if treaty.source_url:
        source = SourceReference(
            url=treaty.source_url,
            description=treaty.source_description or treaty.name,
            accessed=treaty.last_verified,
            document_ref=doc_ref,
        )
    return TreatyInfo(
        treaty_name=treaty.name,
        min_share_percent=treaty.min_share_percent,
        max_share_percent=treaty.max_share_percent,
        creative_requirements=treaty.creative_requirements_summary,
        competent_authorities=authorities,
        requires_approval=treaty.requires_prior_approval,
        source=source,
    )


def _shoot_countries_sorted(project: ProjectInput) -> list[tuple[str, float]]:
    """List of (country_code, percent) sorted by percent descending."""
    result: list[tuple[str, float]] = []
    for loc in project.shoot_locations:
        if not loc.country or not loc.country.strip():
            continue
        code = countries.resolve_or_keep(loc.country)
        result.append((code.upper(), loc.percent))
    result.sort(key=lambda x: -x[1])
    return result


def _evaluate_country(
    project: ProjectInput,
    country_code: str,
    by_country: dict[str, list[Incentive]],
    doc_by_incentive: dict[int, list[DocumentAnnotation]] | None = None,
    cache: dict[str, tuple[list[EligibleIncentive], list[Requirement], float, list[NearMiss]]] | None = None,
) -> tuple[list[EligibleIncentive], list[Requirement], float, list[NearMiss]]:
    """Evaluate all incentives for a country. Returns (eligible_incentives, requirements, total_pct, near_misses)."""
    country_key = country_code.upper()
    if cache is not None and country_key in cache:
        return cache[country_key]

    eligible: list[EligibleIncentive] = []
    all_reqs: list[Requirement] = []
    near_misses: list[NearMiss] = []
    total_pct = 0.0
    doc_by_incentive = doc_by_incentive or {}

    # First pass: evaluate everything
    candidates = []
    ineligible_incs = []
    for inc in by_country.get(country_key, []):
        anns = doc_by_incentive.get(inc.id)
        doc_ref = _first_doc_ref(anns) if anns else None
        ok, reqs, rebate_pct, benefit = check_incentive_eligibility(project, inc, doc_ref)
        if ok:
            candidates.append({
                "inc": inc,
                "reqs": reqs,
                "rebate_pct": rebate_pct,
                "benefit": benefit
            })
        else:
            ineligible_incs.append(inc)

    # Second pass: handle mutual exclusivity and fit
    candidates.sort(key=lambda x: _candidate_sort_key(project, x["inc"], x["rebate_pct"], x["reqs"]), reverse=True)

    selected_names = set()
    excluded_names = set()
    selected_orientations: dict[str, str] = {}

    for cand in candidates:
        name = cand["inc"].name
        if name in excluded_names:
            continue

        orientation = _incentive_market_orientation(cand["inc"])
        orientation_key = cand["inc"].country_code.upper()
        if orientation and selected_orientations.get(orientation_key) not in (None, orientation):
            continue

        is_selective = _is_selective_incentive(cand["inc"])
        counted_in_totals = (not is_selective) and _counts_toward_bankable_total(cand["reqs"])
        counted_pct = cand["rebate_pct"] if counted_in_totals else 0.0
        selective_fit_score = _selective_fit_score(project, cand["inc"], cand["reqs"]) if is_selective else None

        eligible.append(EligibleIncentive(
            name=cand["inc"].name,
            country_code=cand["inc"].country_code,
            country_name=countries.display_name(cand["inc"].country_code),
            region=cand["inc"].region,
            incentive_type=cand["inc"].incentive_type,
            selection_mode=getattr(cand["inc"], "selection_mode", "automatic"),
            operator_type=getattr(cand["inc"], "operator_type", "government"),
            application_status=getattr(cand["inc"], "application_status", "unknown"),
            application_note=getattr(cand["inc"], "application_note", None),
            typical_award_amount=getattr(cand["inc"], "typical_award_amount", None),
            typical_award_currency=getattr(cand["inc"], "typical_award_currency", None),
            selective_fit_score=selective_fit_score,
            rebate_percent=cand["inc"].rebate_percent,
            requirements=cand["reqs"],
            benefit=cand["benefit"],
            estimated_contribution_percent=counted_pct,
            potential_contribution_percent=cand["rebate_pct"] if not is_selective else 0.0,
            counted_in_totals=counted_in_totals,
        ))
        total_pct += counted_pct
        all_reqs.extend(cand["reqs"])
        selected_names.add(name)
        if orientation:
            selected_orientations[orientation_key] = orientation

        # Mark mutually exclusive ones as excluded
        if cand["inc"].mutually_exclusive_with:
            for exc_name in cand["inc"].mutually_exclusive_with:
                excluded_names.add(exc_name)

    # Third pass: check near-misses for ineligible incentives
    for inc in ineligible_incs:
        anns = doc_by_incentive.get(inc.id)
        doc_ref = _first_doc_ref(anns) if anns else None
        nm = check_near_miss(project, inc, doc_ref=doc_ref)
        if nm and nm.incentive_name not in selected_names and nm.incentive_name not in excluded_names:
            near_misses.append(nm)

    result = (eligible, all_reqs, total_pct, near_misses)
    if cache is not None:
        cache[country_key] = result
    return result


def _project_existing_codes(project: ProjectInput) -> set[str]:
    """Countries already present in the project's current setup."""
    codes: set[str] = set()

    for loc in project.shoot_locations:
        if loc.country and loc.country.strip():
            codes.add(countries.resolve_or_keep(loc.country).upper())

    for nat in (project.director_nationalities or []) + (project.producer_nationalities or []):
        if nat and nat.strip():
            codes.add(countries.resolve_or_keep(nat).upper())

    for prod_cc in project.production_company_countries or []:
        if prod_cc and prod_cc.strip():
            codes.add(countries.resolve_or_keep(prod_cc).upper())

    if getattr(project, "production_company_country", None):
        codes.add(countries.resolve_or_keep(project.production_company_country).upper())

    for cc in project.has_coproducer or []:
        if cc and cc.strip():
            codes.add(countries.resolve_or_keep(cc).upper())

    return codes


def _project_open_codes(project: ProjectInput) -> set[str]:
    """Countries the user explicitly said they are open to exploring."""
    return {
        countries.resolve_or_keep(code).upper()
        for code in (project.open_to_copro_countries or [])
        if code and code.strip()
    }


def _has_explicit_spend(project: ProjectInput, country_code: str) -> bool:
    cc = country_code.upper()
    return any(countries.resolve_or_keep(alloc.country).upper() == cc for alloc in project.spend_allocations)


def _has_existing_coproducer(project: ProjectInput, country_code: str) -> bool:
    cc = country_code.upper()
    return any(countries.resolve_or_keep(code).upper() == cc for code in (project.has_coproducer or []))


def _is_quantified_incentive(inc: EligibleIncentive) -> bool:
    return inc.rebate_percent is not None or inc.typical_award_amount is not None


def _is_discretionary_incentive(inc: EligibleIncentive) -> bool:
    return inc.selection_mode.lower() == "selective" or inc.rebate_percent is None


def _is_quantified_programme(inc: Incentive) -> bool:
    return inc.rebate_percent is not None or getattr(inc, "typical_award_amount", None) is not None


def _is_discretionary_programme(inc: Incentive) -> bool:
    return (getattr(inc, "selection_mode", "automatic") or "automatic").lower() == "selective" or inc.rebate_percent is None


def _partner_requirement_categories(partner: CoproductionPartner) -> set[str]:
    categories: set[str] = set()
    for inc in partner.eligible_incentives:
        for req in inc.requirements:
            categories.add(req.category)
    return categories


def _partner_quantified_value(partner: CoproductionPartner) -> float:
    total = 0.0
    for inc in partner.eligible_incentives:
        if _is_quantified_incentive(inc):
            total += inc.estimated_contribution_percent + (0.35 * inc.potential_contribution_percent)
    return round(total, 2)


def _partner_has_quantified_signal(partner: CoproductionPartner) -> bool:
    return any(_is_quantified_incentive(inc) for inc in partner.eligible_incentives)


def _partner_is_discretionary_only(partner: CoproductionPartner) -> bool:
    return bool(partner.eligible_incentives) and all(_is_discretionary_incentive(inc) for inc in partner.eligible_incentives)


def _country_has_practical_signal(project: ProjectInput, country_code: str) -> bool:
    cc = country_code.upper()
    return (
        _percent_in_country(project, cc) > 0
        or _has_explicit_spend(project, cc)
        or _project_has_local_ties(project, cc)
        or cc in _project_open_codes(project)
    )


def _scenario_financial_score(scenario: Scenario) -> float:
    return round(
        scenario.estimated_total_financing_percent + (0.35 * scenario.estimated_conditional_financing_percent),
        2,
    )


def _scenario_practical_score(
    project: ProjectInput,
    scenario: Scenario,
) -> float:
    """Score how realistic and project-specific a scenario is."""
    existing_codes = _project_existing_codes(project)
    open_codes = _project_open_codes(project)
    practical_score = 0.0

    for partner in scenario.partners:
        code = partner.country_code.upper()
        partner_value = _partner_quantified_value(partner)
        requirement_categories = _partner_requirement_categories(partner)
        has_signal = _country_has_practical_signal(project, code)
        is_added_country = code not in existing_codes
        is_explicit_override = code in open_codes

        if _percent_in_country(project, code) > 0:
            practical_score += 1.8
        if _has_explicit_spend(project, code):
            practical_score += 1.3
        if _project_has_local_ties(project, code):
            practical_score += 1.8
        if _has_existing_coproducer(project, code):
            practical_score += 1.0
        if is_explicit_override:
            practical_score += 0.9

        if partner_value > 0:
            practical_score += min(3.0, partner_value * 0.45)
        elif _partner_has_quantified_signal(partner):
            practical_score -= 1.0
        else:
            practical_score -= 2.3

        if partner.applicable_treaties:
            practical_score += 0.5

        penalty_by_category = {
            "budget": 1.2,
            "spend": 1.2,
            "shoot": 1.1,
            "producer": 0.9,
            "cultural": 0.8,
            "region": 0.8,
            "stage": 0.5,
            "production": 0.5,
        }
        for category in requirement_categories:
            practical_score -= penalty_by_category.get(category, 0.3)

        if is_added_country and not has_signal:
            practical_score -= 2.0
    return round(practical_score, 2)


def _scenario_rank_score(project: ProjectInput, scenario: Scenario) -> float:
    """Combined deterministic rank score for ordering scenarios."""
    return round(_scenario_financial_score(scenario) + _scenario_practical_score(project, scenario), 2)


def _count_changes_needed(
    project: ProjectInput,
    country_codes: list[str],
    by_country: dict[str, list[Incentive]],
) -> int:
    """Count how many changes the user would need to make for this scenario.
    Lower = more feasible / closer to current setup. Used for ranking."""
    changes = 0
    shoot_codes = set()
    for loc in project.shoot_locations:
        if loc.country and loc.country.strip():
            shoot_codes.add(countries.resolve_or_keep(loc.country).upper())

    nat_codes = set()
    for nat in (project.director_nationalities or []) + (project.producer_nationalities or []):
        if nat and nat.strip():
            nat_codes.add(countries.resolve_or_keep(nat).upper())
    for cc in project.production_company_countries or []:
        if cc and cc.strip():
            nat_codes.add(countries.resolve_or_keep(cc).upper())
    if getattr(project, 'production_company_country', None):
        nat_codes.add(countries.resolve_or_keep(project.production_company_country).upper())

    known_codes = shoot_codes | nat_codes

    for cc in country_codes:
        if cc not in known_codes:
            changes += 2  # adding a new country is a big change
        elif cc not in shoot_codes:
            changes += 1  # nationality connection but no shoot yet

    return changes


def _build_scenario(
    project: ProjectInput,
    country_codes: list[str],
    by_country: dict[str, list[Incentive]],
    treaties_by_pair: dict[tuple[str, str], list[Treaty]],
    partners_by_country: dict[str, list[str]],
    doc_by_incentive: dict[int, list[DocumentAnnotation]] | None = None,
    doc_by_treaty: dict[int, list[DocumentAnnotation]] | None = None,
    country_eval_cache: dict[str, tuple[list[EligibleIncentive], list[Requirement], float, list[NearMiss]]] | None = None,
    include_suggestions: bool = True,
) -> Scenario | None:
    """Build a scenario from a list of country codes. Returns None only if zero incentives exist in DB for these countries."""
    # Pre-sort countries to determine "majority" vs "minority"
    # Logic:
    # 1. If project has shoot locations, the one with highest shoot % is majority.
    # 2. If no shoot locations (or tied), the one with highest incentive benefit is majority.
    country_stats = []
    for cc in country_codes:
        eligible, _, pct, _ = _evaluate_country(project, cc, by_country, doc_by_incentive, country_eval_cache)
        shoot_pct = _percent_in_country(project, cc)
        # Sort key: (shoot_pct, total_incentive_pct, num_incentives)
        score = (shoot_pct, pct, len(eligible))
        country_stats.append((cc, score))

    # Sort by score descending
    sorted_codes = [cc for cc, _ in sorted(country_stats, key=lambda x: x[1], reverse=True)]

    partners: list[CoproductionPartner] = []
    all_requirements: list[Requirement] = []
    treaty_basis: list[TreatyInfo] = []
    total_pct = 0.0
    potential_total_pct = 0.0
    seen_treaties: set[int] = set()

    all_near_misses: list[NearMiss] = []

    for i, cc in enumerate(sorted_codes):
        eligible, reqs, pct, near_misses = _evaluate_country(project, cc, by_country, doc_by_incentive, country_eval_cache)
        all_near_misses.extend(near_misses)
        shoot_pct = _percent_in_country(project, cc)

        role = "majority" if i == 0 else "minority"

        partner_treaties: list[TreatyInfo] = []
        for other_cc in country_codes:
            if other_cc == cc:
                continue
            for treaty in _get_treaties_for_pair(treaties_by_pair, cc, other_cc):
                if treaty.id not in seen_treaties:
                    seen_treaties.add(treaty.id)
                    info = _treaty_to_info(treaty, doc_by_treaty)
                    partner_treaties.append(info)
                    treaty_basis.append(info)

        partners.append(CoproductionPartner(
            country_code=cc,
            country_name=countries.display_name(cc),
            role=role,
            estimated_share_percent=round(shoot_pct, 1) if shoot_pct else None,
            eligible_incentives=eligible,
            applicable_treaties=partner_treaties,
        ))
        total_pct += pct
        potential_total_pct += sum(inc.potential_contribution_percent for inc in eligible)
        all_requirements.extend(reqs)

    # Check there's at least some incentive data for these countries
    total_incentives = sum(len(p.eligible_incentives) for p in partners)
    if total_incentives == 0:
        # Check if the countries even have data — if not, skip entirely
        has_any_data = any(cc.upper() in by_country for cc in country_codes)
        if not has_any_data:
            print(f"    Total incentives: 0. has_any_data for {country_codes}: False")
            return None

    # Deduplicate requirements
    seen_descs: set[str] = set()
    unique_reqs: list[Requirement] = []
    for r in all_requirements:
        if r.description not in seen_descs:
            seen_descs.add(r.description)
            unique_reqs.append(r)

    amount = (project.budget * total_pct / 100) if project.budget else 0
    conditional_pct = max(potential_total_pct - total_pct, 0.0)
    conditional_amount = (project.budget * conditional_pct / 100) if project.budget else 0
    currency = project.budget_currency or "EUR"

    rationale = _build_rationale(partners, treaty_basis, total_pct, conditional_pct, currency, amount, conditional_amount)

    # Sort near-misses by potential benefit (highest first), limit to top 5
    all_near_misses.sort(key=lambda nm: -(nm.potential_benefit_amount or 0))
    top_near_misses = all_near_misses[:5]

    scenario = Scenario(
        partners=partners,
        estimated_total_financing_percent=round(total_pct, 1),
        estimated_total_financing_amount=round(amount, 0),
        estimated_conditional_financing_percent=round(conditional_pct, 1),
        estimated_conditional_financing_amount=round(conditional_amount, 0),
        financing_currency=currency,
        requirements=unique_reqs,
        suggestions=[],
        near_misses=top_near_misses,
        rationale=rationale,
        treaty_basis=treaty_basis,
    )
    if include_suggestions:
        scenario.suggestions = _build_suggestions(
            project,
            scenario,
            by_country,
            treaties_by_pair,
            partners_by_country,
            currency,
            doc_by_incentive=doc_by_incentive,
            doc_by_treaty=doc_by_treaty,
            country_eval_cache=country_eval_cache,
        )
    return scenario


def _build_rationale(
    partners: list[CoproductionPartner],
    treaties: list[TreatyInfo],
    total_pct: float,
    conditional_pct: float,
    currency: str,
    amount: float,
    conditional_amount: float,
) -> str:
    """Generate a human-readable explanation of why this scenario works."""
    parts = []

    country_names = [p.country_name for p in partners]
    if len(country_names) == 1:
        parts.append(f"This is a single-country setup in {country_names[0]}.")
    else:
        parts.append(f"This setup is a coproduction between {', '.join(country_names[:-1])} and {country_names[-1]}.")

    if treaties:
        treaty_names = [t.treaty_name for t in treaties]
        parts.append(f"Possible treaty route: {'; '.join(treaty_names)}.")

    incentive_count = sum(len(p.eligible_incentives) for p in partners)
    if incentive_count > 0 and total_pct > 0 and conditional_pct > 0:
        parts.append(
            f"The calculator found {incentive_count} relevant incentive(s), "
            f"with about {total_pct:.1f}% of budget ({currency} {amount:,.0f}) looking available from the current inputs, "
            f"plus conditional upside of {conditional_pct:.1f}% ({currency} {conditional_amount:,.0f}) if the remaining requirements are satisfied."
        )
    elif incentive_count > 0 and total_pct > 0:
        parts.append(
            f"The calculator found {incentive_count} relevant incentive(s), "
            f"with about {total_pct:.1f}% of budget ({currency} {amount:,.0f}) looking available from the current inputs."
        )
    elif incentive_count > 0 and conditional_pct > 0:
        parts.append(
            f"The calculator found {incentive_count} relevant incentive(s), "
            f"but none look bankable from the current inputs yet. "
            f"If the remaining conditions are resolved, modeled upside could reach about {conditional_pct:.1f}% "
            f"of budget ({currency} {conditional_amount:,.0f})."
        )
    elif incentive_count > 0:
        parts.append(f"The calculator found {incentive_count} relevant incentive(s), but they remain too conditional to model as available financing yet.")
    else:
        parts.append("No incentives clearly match yet. The treaty structure may still be useful, but more changes would be needed.")

    return " ".join(parts)


def _build_suggestions(
    project: ProjectInput,
    scenario: Scenario,
    by_country: dict[str, list[Incentive]],
    treaties_by_pair: dict[tuple[str, str], list[Treaty]],
    partners_by_country: dict[str, list[str]],
    currency: str,
    doc_by_incentive: dict[int, list[DocumentAnnotation]] | None = None,
    doc_by_treaty: dict[int, list[DocumentAnnotation]] | None = None,
    country_eval_cache: dict[str, tuple[list[EligibleIncentive], list[Requirement], float, list[NearMiss]]] | None = None,
) -> list[Suggestion]:
    """Suggest ways to unlock more funding."""
    suggestions: list[Suggestion] = []
    current_codes = [partner.country_code for partner in scenario.partners]
    base_financial_score = _scenario_financial_score(scenario)
    open_codes = _project_open_codes(project)

    # Suggest increasing shoot in countries where min_shoot_percent isn't met
    for cc in current_codes:
        shoot_pct = _percent_in_country(project, cc)
        for inc in by_country.get(cc.upper(), []):
            if inc.min_shoot_percent and shoot_pct < inc.min_shoot_percent and inc.rebate_percent:
                total_shoot = sum(loc.percent for loc in project.shoot_locations) or 100.0
                target_spend = project.budget * project.shooting_spend_fraction * (inc.min_shoot_percent / total_shoot)
                est_benefit = target_spend * (inc.rebate_percent / 100.0)
                inc_currency = inc.max_cap_currency or "EUR"
                if inc.max_cap_amount and est_benefit > inc.max_cap_amount:
                    est_benefit = inc.max_cap_amount
                source = None
                if inc.source_url:
                    source = SourceReference(url=inc.source_url, description=inc.source_description or inc.name)
                suggestions.append(Suggestion(
                    suggestion_type="increase_shoot",
                    country=countries.display_name(cc),
                    description=(
                        f"Increase shoot in {countries.display_name(cc)} from {shoot_pct:.0f}% to "
                        f"{inc.min_shoot_percent}% to qualify for {inc.name} ({inc.rebate_percent}%)."
                    ),
                    potential_benefit=f"~{inc_currency} {est_benefit:,.0f} ({inc.rebate_percent}% on qualifying spend)",
                    estimated_amount=round(est_benefit, 0),
                    estimated_currency=inc_currency,
                    effort_level="low" if (inc.min_shoot_percent - shoot_pct) <= 10 else "medium",
                    source=source,
                ))
                break

    if not project.willing_add_coproducer:
        return suggestions[:5]

    partner_suggestions: list[Suggestion] = []
    seen_partner_codes: set[str] = set()
    for cc in current_codes:
        for partner_code in _get_all_treaty_partners(partners_by_country, cc):
            if partner_code in current_codes or partner_code in seen_partner_codes:
                continue
            seen_partner_codes.add(partner_code)
            if open_codes and partner_code not in open_codes:
                continue

            incs = by_country.get(partner_code, [])
            if not any(_is_quantified_programme(inc) and not _is_discretionary_programme(inc) for inc in incs):
                continue

            candidate = _build_scenario(
                project,
                current_codes + [partner_code],
                by_country,
                treaties_by_pair,
                partners_by_country,
                doc_by_incentive,
                doc_by_treaty,
                country_eval_cache,
                include_suggestions=False,
            )
            if not candidate:
                continue

            candidate_practical_score = _scenario_practical_score(project, candidate)
            if candidate_practical_score < -3.0 and partner_code not in open_codes:
                continue

            candidate_partner = next((p for p in candidate.partners if p.country_code == partner_code), None)
            if not candidate_partner:
                continue

            quantified_incentives = [inc for inc in candidate_partner.eligible_incentives if _is_quantified_incentive(inc)]
            if not quantified_incentives:
                continue

            partner_value = _partner_quantified_value(candidate_partner)
            added_financial_score = round(_scenario_financial_score(candidate) - base_financial_score, 2)
            if added_financial_score <= 0 and partner_value <= 0:
                continue

            best = max(
                quantified_incentives,
                key=lambda inc: inc.estimated_contribution_percent + (0.35 * inc.potential_contribution_percent),
            )
            estimated_amount = round(project.budget * max(added_financial_score, 0) / 100.0, 0) if project.budget else 0
            if estimated_amount <= 0:
                estimated_amount = round(project.budget * partner_value / 100.0, 0) if project.budget else 0
            if estimated_amount <= 0:
                continue

            treaties = _get_treaties_for_pair(treaties_by_pair, cc, partner_code)
            treaty_note = f" ({treaties[0].name})" if treaties else ""
            source = best.benefit.sources[0] if best.benefit and best.benefit.sources else None
            partner_suggestions.append(Suggestion(
                suggestion_type="add_copro",
                country=countries.display_name(partner_code),
                description=f"Add {countries.display_name(partner_code)} as coproduction partner{treaty_note} to unlock {best.name}.",
                potential_benefit=f"~{currency} {estimated_amount:,.0f} based on modeled scenario upside",
                estimated_amount=estimated_amount,
                estimated_currency=currency,
                effort_level="high",
                source=source,
            ))

    partner_suggestions.sort(key=lambda s: -(s.estimated_amount or 0))
    suggestions.extend(partner_suggestions)

    return suggestions[:5]


def _counts_toward_bankable_total(requirements: list[Requirement]) -> bool:
    """Return True when remaining requirements are light enough to count in headline totals."""
    for req in requirements:
        if req.category in {"budget", "spend", "producer", "cultural", "stage", "region"}:
            return False
        if req.category == "production" and "Right now your inputs do not leave room for that" in req.description:
            return False
    return True


def _is_selective_incentive(incentive: Incentive) -> bool:
    return (getattr(incentive, "selection_mode", "automatic") or "automatic").lower() == "selective"


def _project_stage_fit(project: ProjectInput, incentive: Incentive) -> float:
    eligible_stages = incentive.eligible_stages or []
    if not eligible_stages:
        return 1.0
    if project.stage in eligible_stages:
        return 1.0
    if any(stage in eligible_stages for stage in (project.stages or [])):
        return 0.6
    return 0.0


def _selective_fit_score(project: ProjectInput, incentive: Incentive, requirements: list[Requirement]) -> float:
    """Rank selective opportunities by fit rather than indicative cash amount."""
    score = 0.0

    score += 2.0  # format already hard-matched before this point
    score += 3.0 * _project_stage_fit(project, incentive)

    shoot_pct = _percent_in_country(project, incentive.country_code)
    if incentive.region and any(req.category == "region" for req in requirements):
        score += 0.5
    elif shoot_pct > 0:
        score += 2.0

    if _project_has_local_ties(project, incentive.country_code):
        score += 2.0
    elif incentive.local_producer_required and project.willing_add_coproducer:
        score += 1.0

    if any(countries.resolve_or_keep(c).upper() == incentive.country_code.upper() for c in (project.open_to_copro_countries or [])):
        score += 1.0

    penalty_by_category = {
        "budget": 1.0,
        "spend": 1.0,
        "shoot": 1.0,
        "producer": 0.8,
        "region": 0.8,
        "cultural": 0.7,
        "stage": 0.5,
        "production": 0.5,
    }
    for req in requirements:
        score -= penalty_by_category.get(req.category, 0.3)

    return round(score, 2)


def _project_has_local_ties(project: ProjectInput, country_code: str) -> bool:
    cc = country_code.upper()
    if _percent_in_country(project, cc) > 0:
        return True
    if _has_explicit_spend(project, cc):
        return True
    for nat in (project.director_nationalities or []) + (project.producer_nationalities or []):
        if nat and countries.resolve_or_keep(nat).upper() == cc:
            return True
    for prod_cc in project.production_company_countries or []:
        if prod_cc and countries.resolve_or_keep(prod_cc).upper() == cc:
            return True
    if getattr(project, "production_company_country", None):
        if countries.resolve_or_keep(project.production_company_country).upper() == cc:
            return True
    return any(countries.resolve_or_keep(c).upper() == cc for c in (project.has_coproducer or []))


def _incentive_market_orientation(incentive: Incentive) -> str | None:
    text = " ".join(filter(None, [incentive.name, incentive.source_description, incentive.notes])).lower()
    foreign_markers = (
        "tax rebate for international production",
        "international production",
        "foreign productions",
        "foreign production",
        "service production",
        "services tax credit",
    )
    domestic_markers = (
        "(domestic)",
        " domestic ",
        "domestic credit",
        "canadian film or video production",
        "french-initiated",
        "official coproduction",
    )
    if any(marker in text for marker in foreign_markers):
        return "foreign"
    if any(marker in text for marker in domestic_markers):
        return "domestic"
    return None


def _candidate_sort_key(
    project: ProjectInput,
    incentive: Incentive,
    rebate_pct: float,
    requirements: list[Requirement] | None = None,
) -> tuple[float, float]:
    """Higher is better. Bias toward incentives that fit the project's domestic/foreign posture."""
    if _is_selective_incentive(incentive):
        return (_selective_fit_score(project, incentive, requirements or []), rebate_pct)

    fit_score = 0.0
    orientation = _incentive_market_orientation(incentive)
    local_ties = _project_has_local_ties(project, incentive.country_code)
    if orientation == "domestic":
        fit_score = 1.0 if local_ties else -1.0
    elif orientation == "foreign":
        fit_score = 1.0 if not local_ties else -1.0
    return (fit_score, rebate_pct)


def generate_scenarios(project: ProjectInput, db: Session) -> list[Scenario]:
    """Generate and rank financing scenarios.

    Strategy: cast a wide net of country combinations, build scenarios for each,
    then rank by (financing_amount DESC, changes_needed ASC). Always returns results.
    """
    by_country = _get_incentives_by_country(db)
    treaties_by_pair, partners_by_country = _build_treaty_lookups(db)
    doc_by_incentive, doc_by_treaty = _build_doc_lookup(db)
    country_eval_cache: dict[str, tuple[list[EligibleIncentive], list[Requirement], float, list[NearMiss]]] = {}
    shoot_sorted = _shoot_countries_sorted(project)
    scenarios: list[Scenario] = []
    seen_combos: set[tuple[str, ...]] = set()

    def _try_scenario(codes: list[str]) -> None:
        # Filter out empty/invalid codes
        codes = [c.upper() for c in codes if c and c.strip()]
        if not codes:
            return
        key = tuple(sorted(codes))
        if key in seen_combos:
            return
        seen_combos.add(key)
        # print(f"Trying scenario for codes: {codes}")
        s = _build_scenario(
            project,
            codes,
            by_country,
            treaties_by_pair,
            partners_by_country,
            doc_by_incentive,
            doc_by_treaty,
            country_eval_cache,
        )
        if s:
            # print(f"  Success: {s.estimated_total_financing_percent}%")
            scenarios.append(s)
        else:
            print(f"  Failed to build scenario for {codes}")

    shoot_codes = [c for c, _ in shoot_sorted]

    # --- Phase 1: Scenarios close to current setup ---

    # All shoot countries together
    if shoot_codes:
        _try_scenario(shoot_codes[:4])

    # Each shoot country as primary + others
    for code, _ in shoot_sorted:
        others = [c for c in shoot_codes if c != code][:3]
        _try_scenario([code] + others)

    # Director/producer nationality countries + shoot countries
    for nat_list in [project.director_nationalities, project.producer_nationalities]:
        for nat in (nat_list or []):
            if not nat or not nat.strip():
                continue
            code = countries.resolve_or_keep(nat).upper()
            if code not in shoot_codes:
                _try_scenario([code] + shoot_codes[:3])

    # Production company countries
    for cc in project.production_company_countries or []:
        if cc and cc.strip():
            code = countries.resolve_or_keep(cc).upper()
            if code not in shoot_codes:
                _try_scenario([code] + shoot_codes[:3])
    if getattr(project, 'production_company_country', None):
        code = countries.resolve_or_keep(project.production_company_country).upper()
        if code not in shoot_codes:
            _try_scenario([code] + shoot_codes[:3])

    # Treaty partners of shoot countries
    for shoot_code, _ in shoot_sorted[:3]:
        treaty_partners = _get_all_treaty_partners(partners_by_country, shoot_code)
        for partner_code in treaty_partners:
            if partner_code not in shoot_codes:
                _try_scenario(shoot_codes[:3] + [partner_code])

    # User-specified copro countries
    for country in project.open_to_copro_countries or []:
        code = countries.resolve_or_keep(country).upper()
        if code not in shoot_codes:
            _try_scenario([code] + shoot_codes[:3])

    # --- Phase 2: Broader exploration (countries the user hasn't mentioned) ---

    # All countries with incentive data — try each one paired with user's shoot countries
    all_incentive_countries = sorted(by_country.keys())
    for cc in all_incentive_countries:
        if cc in shoot_codes:
            continue
        # Solo country
        _try_scenario([cc])
        # Country + user's shoot countries
        if shoot_codes:
            _try_scenario(shoot_codes[:2] + [cc])

    # Nationality-based solo scenarios (if user hasn't specified shoot locations)
    if not shoot_codes:
        all_nat_lists = [project.director_nationalities, project.producer_nationalities,
                         project.production_company_countries]
        for nat_list in all_nat_lists:
            for nat in (nat_list or []):
                if not nat or not nat.strip():
                    continue
                code = countries.resolve_or_keep(nat).upper()
                _try_scenario([code])
                # Also try this country with its top treaty partners
                for partner in _get_all_treaty_partners(partners_by_country, code)[:5]:
                    _try_scenario([code, partner])

    # --- Phase 3: If we still have nothing, generate single-country fallbacks ---
    if not scenarios:
        # Try every country with incentive data as a standalone option
        for cc in all_incentive_countries:
            _try_scenario([cc])

    scored_scenarios: list[tuple[Scenario, float, int]] = []
    for scenario in scenarios:
        recommendation_score = _scenario_rank_score(project, scenario)
        changes = _count_changes_needed(project, [p.country_code for p in scenario.partners], by_country)
        scored_scenarios.append((scenario, recommendation_score, changes))

    def _score(item: tuple[Scenario, float, int]) -> tuple[float, float, int]:
        scenario, recommendation_score, changes = item
        return (-recommendation_score, -scenario.estimated_total_financing_percent, changes)

    scored_scenarios.sort(key=_score)
    return [scenario for scenario, _, _ in scored_scenarios[:15]]
