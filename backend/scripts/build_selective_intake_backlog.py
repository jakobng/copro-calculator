#!/usr/bin/env python
"""
Build a discovery-driven intake backlog for selective film funds.

This script is intentionally conservative:
- directories are used to discover candidates
- official programme pages remain the canonical source for add decisions
- candidates already in the catalog are omitted from the action backlog
"""
from __future__ import annotations

import csv
import os
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
REPORTS_DIR = BACKEND / "reports"
CSV_PATH = REPORTS_DIR / "selective_funds_intake_backlog.csv"
MD_PATH = REPORTS_DIR / "SELECTIVE_FUNDS_INTAKE_BACKLOG.md"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from app.database import SessionLocal
from app.models import Incentive


DIRECTORY_SOURCES = [
    {
        "source": "IDA Grants Directory",
        "url": "https://www.documentary.org/grants-directory",
        "fit": "high",
        "notes": (
            "Strong nonfiction discovery source. Public view shows active opportunities only; "
            "deadlines and full filters require membership."
        ),
    },
    {
        "source": "Olffi Search",
        "url": "https://www.olffi.com/program/search.html",
        "fit": "medium",
        "notes": (
            "Useful for discovery of public funds and incentives. Public search is login-gated for details, "
            "and Olffi explicitly focuses on publicly funded programmes rather than private/foundation funds."
        ),
    },
    {
        "source": "ScreenFundr",
        "url": "https://www.screenfundr.com/",
        "fit": "medium",
        "notes": (
            "Broad secondary-source database for grants, labs, and funds. Valuable for lead generation, "
            "but not suitable as the canonical source for ingestion."
        ),
    },
]


CANDIDATES = [
    {
        "name": "LEF Moving Image Fund",
        "country_code": "US",
        "discovery_source": "IDA / broader web sweep",
        "official_url": "https://lef-foundation.org/moving-image-fund/guidelines/",
        "status": "ready_to_add",
        "reason": "Official guidelines publish phases, caps, geography, and deadline structure.",
        "notes": (
            "New England feature documentary fund with clear published amounts by stage: "
            "USD 2.5k early development, USD 5k pre-production, USD 15k production, USD 25k post."
        ),
    },
    {
        "name": "IDA Logan Elevate Grant",
        "country_code": "US",
        "discovery_source": "IDA",
        "official_url": "https://www.documentary.org/creators/funding/logan-elevate-grant",
        "status": "ready_to_add",
        "reason": "Official page publishes amount, target filmmaker profile, and current paused status.",
        "notes": (
            "Three unrestricted USD 30k grants for emerging women and non-binary filmmakers of color "
            "directing feature-length journalistic documentaries; paused for the 2025 cycle."
        ),
    },
    {
        "name": "Jewish Story Partners Jury Grants",
        "country_code": "US",
        "discovery_source": "IDA / broader web sweep",
        "official_url": "https://jewishstorypartners.org/guidelines/",
        "status": "ready_to_add_with_award_gap",
        "reason": "Official guidelines clearly define eligibility and timing, but do not publish a per-project cap.",
        "notes": (
            "Annual open call for U.S. documentary features at development through post-production stages "
            "with late-fall opening and January deadline; likely addable, but would carry a missing-award-signal flag."
        ),
    },
    {
        "name": "Women In Film Film Finishing Fund",
        "country_code": "US",
        "discovery_source": "ScreenFundr / broader web sweep",
        "official_url": "https://www.wif.org/programs/film-finishing-fund/",
        "status": "needs_primary_source_verification",
        "reason": "Current official page confirms the programme exists but does not publish a current cycle, dates, or a clear current award structure.",
        "notes": (
            "Potentially strong candidate, but current public page is too stale and retrospective to ingest confidently."
        ),
    },
    {
        "name": "Miller / Packan Documentary Film Fund",
        "country_code": "US",
        "discovery_source": "IDA / broader web sweep",
        "official_url": "https://rogovy.org/film-fund/",
        "status": "hold_suspended",
        "reason": "Official pages publish strong criteria and caps, but the foundation has suspended the open-call fund.",
        "notes": (
            "Historically up to USD 25k with biannual awards, but the Rogovy Foundation announced suspension "
            "and is no longer accepting open-call submissions."
        ),
    },
    {
        "name": "Points North Fellowship",
        "country_code": "US",
        "discovery_source": "IDA / broader web sweep",
        "official_url": "https://pointsnorthinstitute.org/artist-programs/points-north-fellowship/",
        "status": "exclude_v1",
        "reason": "Current page reads as a fellowship / artist-development programme and does not publish a direct project grant amount.",
        "notes": (
            "Strong programme, but not a clean fit for the current selective-funds lane without a broader fellowship model."
        ),
    },
    {
        "name": "Vision Maker Media Native Youth Media Project",
        "country_code": "US",
        "discovery_source": "broader web sweep",
        "official_url": "https://visionmakermedia.org/wp-content/uploads/2026/03/NYMP_Guidelines.pdf",
        "status": "exclude_v1",
        "reason": "Training-focused youth initiative rather than a general project-financing programme.",
        "notes": (
            "Useful programme, but outside the current product scope for selective production/coproduction opportunities."
        ),
    },
    {
        "name": "Jewish Story Partners Holocaust Film Fund",
        "country_code": "US",
        "discovery_source": "broader web sweep",
        "official_url": "https://jewishstorypartners.org/holocaust-film-fund/",
        "status": "exclude_v1",
        "reason": "This is a thematic sub-pool sourced from JSP's main annual open call, not a standalone application programme.",
        "notes": (
            "Best modeled as a note under a future JSP base record rather than as a separate standalone fund."
        ),
    },
]


def load_existing_names() -> set[str]:
    db = SessionLocal()
    try:
        return {
            name
            for (name,) in db.query(Incentive.name)
            .filter(Incentive.selection_mode == "selective")
            .all()
        }
    finally:
        db.close()


def main() -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    existing_names = load_existing_names()
    rows = []

    for candidate in CANDIDATES:
        row = dict(candidate)
        row["already_in_catalog"] = "yes" if candidate["name"] in existing_names else "no"
        rows.append(row)

    action_rows = [row for row in rows if row["already_in_catalog"] == "no"]
    action_rows.sort(key=lambda row: (row["status"], row["country_code"], row["name"]))

    with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "name",
                "country_code",
                "discovery_source",
                "official_url",
                "status",
                "reason",
                "notes",
                "already_in_catalog",
            ],
        )
        writer.writeheader()
        writer.writerows(action_rows)

    status_counts = Counter(row["status"] for row in action_rows)

    lines = [
        "# Selective Funds Intake Backlog",
        "",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        "## Purpose",
        "Use directories and secondary databases for discovery only. Add records to the main catalog only after confirming eligibility, timing, and award data from the official programme page.",
        "",
        "## Discovery Sources",
        "| Source | Fit | Notes |",
        "|---|---|---|",
    ]
    for source in DIRECTORY_SOURCES:
        lines.append(
            f"| [{source['source']}]({source['url']}) | {source['fit']} | {source['notes']} |"
        )

    lines.extend(
        [
            "",
            "## Summary",
            f"- Current selective funds already in catalog: {len(existing_names)}",
            f"- Backlog candidates tracked here: {len(action_rows)}",
            f"- `ready_to_add`: {status_counts['ready_to_add']}",
            f"- `ready_to_add_with_award_gap`: {status_counts['ready_to_add_with_award_gap']}",
            f"- `needs_primary_source_verification`: {status_counts['needs_primary_source_verification']}",
            f"- `hold_suspended`: {status_counts['hold_suspended']}",
            f"- `exclude_v1`: {status_counts['exclude_v1']}",
            "",
            "## Intake Queue",
            "| Status | Fund | Country | Discovery Source | Reason |",
            "|---|---|---|---|---|",
        ]
    )

    for row in action_rows:
        lines.append(
            f"| {row['status']} | [{row['name']}]({row['official_url']}) | "
            f"{row['country_code']} | {row['discovery_source']} | {row['reason']} |"
        )

    lines.extend(
        [
            "",
            "## Notes",
            "- `ready_to_add` means the official page appears strong enough to add next without relying on directory summaries.",
            "- `ready_to_add_with_award_gap` means the official page is otherwise solid, but likely lacks a published per-project amount and would enter the audit queue with `missing_award_signal`.",
            "- `needs_primary_source_verification` means the programme is promising but the current public official page is too vague or stale for safe ingestion.",
            "- `hold_suspended` means the official programme is documented but currently suspended, so it is not a priority add unless historical closed programmes become in-scope.",
            "- `exclude_v1` means the opportunity does not fit the current selective-funds lane cleanly enough to model right now.",
            f"- Full CSV: `{CSV_PATH}`",
        ]
    )

    MD_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Selective intake backlog written to {MD_PATH}")
    print(f"Selective intake CSV written to {CSV_PATH}")


if __name__ == "__main__":
    main()
