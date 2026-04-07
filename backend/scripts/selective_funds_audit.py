#!/usr/bin/env python
"""
Audit selective / discretionary film-fund records.

Generates a targeted review queue for catalog expansion by flagging:
- missing or weak application window metadata
- missing indicative award metadata
- generic source URLs
- stale verification dates

Usage:
  python backend/scripts/selective_funds_audit.py
"""
from __future__ import annotations

import csv
import os
import re
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
REPORTS_DIR = BACKEND / "reports"
CSV_PATH = REPORTS_DIR / "selective_funds_audit.csv"
MD_PATH = REPORTS_DIR / "SELECTIVE_FUNDS_AUDIT.md"
SEED_PATH = BACKEND / "seed_data.py"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from app.database import SessionLocal
from app.models import Incentive


MONTH_NAME_PATTERN = re.compile(
    r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|"
    r"dec(?:ember)?)\b",
    re.IGNORECASE,
)
NUMERIC_DATE_PATTERN = re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b")


def parse_last_verified(last_verified: str | None) -> date | None:
    if not last_verified:
        return None

    parts = last_verified.split("-")
    if len(parts) != 2:
        return None

    year, month = int(parts[0]), int(parts[1])
    if month == 12:
        return date(year + 1, 1, 1) - timedelta(days=1)
    return date(year, month + 1, 1) - timedelta(days=1)


def freshness_bucket(last_verified: str | None) -> tuple[str, int | None]:
    verified_date = parse_last_verified(last_verified)
    if not verified_date:
        return "missing", None

    days_old = (date.today() - verified_date).days
    if days_old < 180:
        return "current", days_old
    if days_old < 365:
        return "aging", days_old
    return "stale", days_old


def has_explicit_date(note: str | None) -> bool:
    if not note:
        return False
    return bool(MONTH_NAME_PATTERN.search(note) or NUMERIC_DATE_PATTERN.search(note))


def source_domain(url: str | None) -> str:
    if not url:
        return ""
    return urlparse(url).netloc.lower()


def is_generic_source_url(url: str | None) -> bool:
    if not url:
        return True
    parsed = urlparse(url)
    path = parsed.path.strip("/")
    if not path:
        return True
    return path.count("/") == 0 and path.lower() in {
        "en",
        "funding",
        "grants",
        "services2.htm",
        "services3.htm",
    }


def line_number_for_name(seed_text: str, name: str) -> int | None:
    marker = f'name="{name}"'
    idx = seed_text.find(marker)
    if idx == -1:
        return None
    return seed_text[:idx].count("\n") + 1


def build_flags(incentive: Incentive, current_freshness: str) -> list[str]:
    flags: list[str] = []

    note = incentive.application_note or ""
    if incentive.application_status == "unknown":
        flags.append("status_unknown")
    if not note:
        flags.append("missing_application_note")
    elif not has_explicit_date(note) and incentive.application_status != "rolling":
        flags.append("deadline_not_specific")
    if incentive.typical_award_amount is None and incentive.max_cap_amount is None:
        flags.append("missing_award_signal")
    if is_generic_source_url(incentive.source_url):
        flags.append("generic_source_url")
    if not incentive.source_description:
        flags.append("missing_source_description")
    if current_freshness in {"aging", "stale", "missing"}:
        flags.append(f"freshness_{current_freshness}")
    return flags


def main() -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    seed_text = SEED_PATH.read_text(encoding="utf-8", errors="ignore")
    db = SessionLocal()
    try:
        selective = (
            db.query(Incentive)
            .filter(Incentive.selection_mode == "selective")
            .order_by(Incentive.country_code, Incentive.name)
            .all()
        )

        rows = []
        status_counts = Counter()
        operator_counts = Counter()
        freshness_counts = Counter()
        deadline_counts = Counter()
        award_counts = Counter()
        flagged_records = 0

        for incentive in selective:
            freshness, days_old = freshness_bucket(incentive.last_verified)
            flags = build_flags(incentive, freshness)
            priority = len(flags)
            status_counts[incentive.application_status or "unknown"] += 1
            operator_counts[incentive.operator_type or "unknown"] += 1
            freshness_counts[freshness] += 1

            if incentive.application_status == "rolling":
                deadline_counts["rolling"] += 1
            elif has_explicit_date(incentive.application_note):
                deadline_counts["dated"] += 1
            elif incentive.application_note:
                deadline_counts["note_without_date"] += 1
            else:
                deadline_counts["missing"] += 1

            if incentive.typical_award_amount is not None:
                award_counts["typical_award"] += 1
            elif incentive.max_cap_amount is not None:
                award_counts["cap_only"] += 1
            else:
                award_counts["missing"] += 1

            if flags:
                flagged_records += 1

            rows.append(
                {
                    "priority": priority,
                    "name": incentive.name,
                    "country_code": incentive.country_code,
                    "operator_type": incentive.operator_type,
                    "application_status": incentive.application_status,
                    "application_note": incentive.application_note or "",
                    "has_explicit_deadline": "yes" if has_explicit_date(incentive.application_note) else "no",
                    "typical_award_amount": incentive.typical_award_amount,
                    "typical_award_currency": incentive.typical_award_currency or "",
                    "max_cap_amount": incentive.max_cap_amount,
                    "max_cap_currency": incentive.max_cap_currency or "",
                    "last_verified": incentive.last_verified or "",
                    "freshness": freshness,
                    "days_old": days_old if days_old is not None else "",
                    "source_domain": source_domain(incentive.source_url),
                    "source_url": incentive.source_url or "",
                    "source_description": incentive.source_description or "",
                    "flags": ";".join(flags),
                    "seed_line": line_number_for_name(seed_text, incentive.name) or "",
                }
            )

        rows.sort(key=lambda row: (-row["priority"], row["country_code"], row["name"]))

        with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=[
                    "priority",
                    "name",
                    "country_code",
                    "operator_type",
                    "application_status",
                    "application_note",
                    "has_explicit_deadline",
                    "typical_award_amount",
                    "typical_award_currency",
                    "max_cap_amount",
                    "max_cap_currency",
                    "last_verified",
                    "freshness",
                    "days_old",
                    "source_domain",
                    "source_url",
                    "source_description",
                    "flags",
                    "seed_line",
                ],
            )
            writer.writeheader()
            writer.writerows(rows)

        lines = [
            "# Selective Funds Audit",
            "",
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            "",
            "## Summary",
            f"- Total selective funds: {len(rows)}",
            f"- Records with at least one review flag: {flagged_records}",
            f"- Explicit dated application notes: {deadline_counts['dated']}",
            f"- Rolling application notes: {deadline_counts['rolling']}",
            f"- Notes without explicit date: {deadline_counts['note_without_date']}",
            f"- Missing application notes: {deadline_counts['missing']}",
            f"- Typical award present: {award_counts['typical_award']}",
            f"- Cap only (no typical award): {award_counts['cap_only']}",
            f"- No cap or typical award metadata: {award_counts['missing']}",
            "",
            "## Application Status",
            "| Status | Count |",
            "|---|---:|",
        ]
        for key in sorted(status_counts):
            lines.append(f"| {key} | {status_counts[key]} |")

        lines.extend(
            [
                "",
                "## Operator Types",
                "| Operator | Count |",
                "|---|---:|",
            ]
        )
        for key in sorted(operator_counts):
            lines.append(f"| {key} | {operator_counts[key]} |")

        lines.extend(
            [
                "",
                "## Freshness",
                "| Freshness | Count |",
                "|---|---:|",
            ]
        )
        for key in ["current", "aging", "stale", "missing"]:
            if freshness_counts[key]:
                lines.append(f"| {key} | {freshness_counts[key]} |")

        lines.extend(
            [
                "",
                "## Priority Review Queue",
                "| Priority | Fund | Country | Status | Flags | Line |",
                "|---:|---|---|---|---|---:|",
            ]
        )

        for row in rows:
            if row["priority"] == 0:
                continue
            lines.append(
                f"| {row['priority']} | {row['name']} | {row['country_code']} | "
                f"{row['application_status']} | {row['flags'] or '-'} | {row['seed_line']} |"
            )

        lines.extend(
            [
                "",
                "## Notes",
                "- `priority` is the number of audit flags on the record, not a legal or commercial ranking.",
                "- `deadline_not_specific` means the note exists but does not currently expose a concrete date string.",
                "- `generic_source_url` is a heuristic for broad landing pages that may merit a more specific official programme page later.",
                f"- Full CSV: `{CSV_PATH}`",
            ]
        )

        MD_PATH.write_text("\n".join(lines), encoding="utf-8")
        print(f"Selective funds audit written to {MD_PATH}")
        print(f"Selective funds CSV written to {CSV_PATH}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
