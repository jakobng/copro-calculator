# Coverage Gap Summary

This report is generated from `backend/seed_data.py` and `backend/app/countries.py`.

## Snapshot

- Supported countries in catalog: **196**
- Countries with incentives: **154** (78.6%)
- Treaty-only countries (no incentive data yet): **0** (0.0%)
- No coverage (no incentives or treaties): **42** (21.4%)

## Regional Coverage (Incentive or Treaty)

- Africa: **37/54** (68.5%)
- Americas: **34/35** (97.1%)
- Asia: **31/41** (75.6%)
- Europe: **42/49** (85.7%)
- Oceania: **7/14** (50.0%)
- Other: **3/3** (100.0%)

## Highest-Priority Missing Additions

| Code | Country | Region | Status | Priority | Reason |
|---|---|---|---|---:|---|
| YE | Yemen | Asia | no_coverage | 2 | undercovered_region |
| TM | Turkmenistan | Asia | no_coverage | 2 | undercovered_region |
| TL | Timor-Leste | Asia | no_coverage | 2 | undercovered_region |
| TJ | Tajikistan | Asia | no_coverage | 2 | undercovered_region |
| SY | Syria | Asia | no_coverage | 2 | undercovered_region |
| PS | Palestine | Asia | no_coverage | 2 | undercovered_region |
| KP | North Korea | Asia | no_coverage | 2 | undercovered_region |
| KG | Kyrgyzstan | Asia | no_coverage | 2 | undercovered_region |
| IR | Iran | Asia | no_coverage | 2 | undercovered_region |
| AF | Afghanistan | Asia | no_coverage | 2 | undercovered_region |
| NI | Nicaragua | Americas | no_coverage | 2 | undercovered_region |
| WS | Samoa | Oceania | no_coverage | 1 | region_gap |
| TO | Tonga | Oceania | no_coverage | 1 | region_gap |
| PW | Palau | Oceania | no_coverage | 1 | region_gap |
| NR | Nauru | Oceania | no_coverage | 1 | region_gap |
| MH | Marshall Islands | Oceania | no_coverage | 1 | region_gap |
| KI | Kiribati | Oceania | no_coverage | 1 | region_gap |
| FM | Micronesia | Oceania | no_coverage | 1 | region_gap |
| ML | Mali | Africa | no_coverage | 1 | region_gap |
| GH | Ghana | Africa | no_coverage | 1 | region_gap |
| GA | Gabon | Africa | no_coverage | 1 | region_gap |
| ET | Ethiopia | Africa | no_coverage | 1 | region_gap |
| ER | Eritrea | Africa | no_coverage | 1 | region_gap |
| DJ | Djibouti | Africa | no_coverage | 1 | region_gap |
| CV | Cabo Verde | Africa | no_coverage | 1 | region_gap |
| CM | Cameroon | Africa | no_coverage | 1 | region_gap |
| CI | Ivory Coast | Africa | no_coverage | 1 | region_gap |
| CG | Republic of the Congo | Africa | no_coverage | 1 | region_gap |
| CF | Central African Republic | Africa | no_coverage | 1 | region_gap |
| CD | DR Congo | Africa | no_coverage | 1 | region_gap |

## Treaty-Only Countries (Good Next Incentive Targets)

| Code | Country | Bilateral Treaties | Multilateral Member |
|---|---|---:|---|

## Files

- Matrix CSV: `C:/Users/User/Documents/WORK/EXPERIMENTS/copro-calculator/backend/reports/coverage_matrix.csv`
- Summary report: `C:/Users/User/Documents/WORK/EXPERIMENTS/copro-calculator/backend/reports/coverage_summary.md`

## Notes

- `coverage_status` uses incentive data first, then treaty-only.
- `priority_score` is a pragmatic heuristic for sequencing work, not a legal ranking.
- Freshness is based on `last_verified` values embedded in seed data.
