# Selective Funds Intake Backlog

Generated: 2026-04-07 21:17

## Purpose
Use directories and secondary databases for discovery only. Add records to the main catalog only after confirming eligibility, timing, and award data from the official programme page.

## Discovery Sources
| Source | Fit | Notes |
|---|---|---|
| [IDA Grants Directory](https://www.documentary.org/grants-directory) | high | Strong nonfiction discovery source. Public view shows active opportunities only; deadlines and full filters require membership. |
| [Olffi Search](https://www.olffi.com/program/search.html) | medium | Useful for discovery of public funds and incentives. Public search is login-gated for details, and Olffi explicitly focuses on publicly funded programmes rather than private/foundation funds. |
| [ScreenFundr](https://www.screenfundr.com/) | medium | Broad secondary-source database for grants, labs, and funds. Valuable for lead generation, but not suitable as the canonical source for ingestion. |

## Summary
- Current selective funds already in catalog: 56
- Backlog candidates tracked here: 5
- `ready_to_add`: 0
- `ready_to_add_with_award_gap`: 0
- `needs_primary_source_verification`: 1
- `hold_suspended`: 1
- `exclude_v1`: 3

## Intake Queue
| Status | Fund | Country | Discovery Source | Reason |
|---|---|---|---|---|
| exclude_v1 | [Jewish Story Partners Holocaust Film Fund](https://jewishstorypartners.org/holocaust-film-fund/) | US | broader web sweep | This is a thematic sub-pool sourced from JSP's main annual open call, not a standalone application programme. |
| exclude_v1 | [Points North Fellowship](https://pointsnorthinstitute.org/artist-programs/points-north-fellowship/) | US | IDA / broader web sweep | Current page reads as a fellowship / artist-development programme and does not publish a direct project grant amount. |
| exclude_v1 | [Vision Maker Media Native Youth Media Project](https://visionmakermedia.org/wp-content/uploads/2026/03/NYMP_Guidelines.pdf) | US | broader web sweep | Training-focused youth initiative rather than a general project-financing programme. |
| hold_suspended | [Miller / Packan Documentary Film Fund](https://rogovy.org/film-fund/) | US | IDA / broader web sweep | Official pages publish strong criteria and caps, but the foundation has suspended the open-call fund. |
| needs_primary_source_verification | [Women In Film Film Finishing Fund](https://www.wif.org/programs/film-finishing-fund/) | US | ScreenFundr / broader web sweep | Current official page confirms the programme exists but does not publish a current cycle, dates, or a clear current award structure. |

## Notes
- `ready_to_add` means the official page appears strong enough to add next without relying on directory summaries.
- `ready_to_add_with_award_gap` means the official page is otherwise solid, but likely lacks a published per-project amount and would enter the audit queue with `missing_award_signal`.
- `needs_primary_source_verification` means the programme is promising but the current public official page is too vague or stale for safe ingestion.
- `hold_suspended` means the official programme is documented but currently suspended, so it is not a priority add unless historical closed programmes become in-scope.
- `exclude_v1` means the opportunity does not fit the current selective-funds lane cleanly enough to model right now.
- Full CSV: `C:\Users\User\Documents\WORK\EXPERIMENTS\copro-calculator\backend\reports\selective_funds_intake_backlog.csv`