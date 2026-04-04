import { useMemo, useState } from 'react'
import type { Scenario, EligibleIncentive, Requirement, ProjectInput } from '../types'
import { SourceBadge } from './SourceLink'
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, ArrowRight, HelpCircle, RotateCcw } from 'lucide-react'

type DocOpenHandler = (documentId: number, annotationId?: number | null) => void
type CulturalStatus = 'unknown' | 'pass' | 'fail'

interface Props {
  scenarios: Scenario[]
  project: ProjectInput
  budget: number
  currency: string
  onProjectUpdate: (project: ProjectInput) => void
  onReanalyze: () => void
  onDocumentOpen?: DocOpenHandler
}

interface CulturalChecklistItem {
  id: string
  label: string
  help?: string
  defaultChecked?: boolean
}

function fmt(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function budgetPercent(amount: number, budget: number) {
  if (!budget) return 0
  return Number(((amount / budget) * 100).toFixed(1))
}

function incentiveAmount(inc: EligibleIncentive) {
  return inc.benefit?.benefit_amount || 0
}

function hasCountryName(values: string[] | undefined, countryCode: string, countryName: string) {
  return (values || []).some((value) => {
    const normalized = value.trim().toLowerCase()
    return normalized === countryCode.toLowerCase() || normalized === countryName.toLowerCase()
  })
}

function hasShootInCountry(project: ProjectInput, countryCode: string, countryName: string) {
  return project.shoot_locations.some((loc) => {
    const normalized = loc.country.trim().toLowerCase()
    return normalized === countryCode.toLowerCase() || normalized === countryName.toLowerCase()
  })
}

function hasLanguage(project: ProjectInput, language: string) {
  return project.languages.some((entry) => entry.trim().toLowerCase() === language.toLowerCase())
}

function requirementThresholdText(inc: EligibleIncentive) {
  const culturalRequirement = inc.requirements.find((r) => r.category === 'cultural')
  if (culturalRequirement) return culturalRequirement.description

  const match = inc.benefit?.criteria_summary.match(/pass cultural test(?: \(([^)]+)\))?/i)
  if (match?.[1]) return `This programme requires a cultural test (${match[1]}).`
  if (/cultural test/i.test(inc.benefit?.criteria_summary || '')) return 'This programme requires a cultural test.'
  return ''
}

function incentiveNeedsCulturalTest(inc: EligibleIncentive) {
  return inc.requirements.some((r) => r.category === 'cultural')
    || /cultural test/i.test(inc.benefit?.criteria_summary || '')
    || /cultural test/i.test(inc.benefit?.benefit_explanation || '')
}

function getCulturalStatus(project: ProjectInput, countryCode: string): CulturalStatus {
  if (project.cultural_test_passed.includes(countryCode)) return 'pass'
  if (project.cultural_test_failed.includes(countryCode)) return 'fail'
  return 'unknown'
}

function buildUpdatedProject(project: ProjectInput, countryCode: string, status: Exclude<CulturalStatus, 'unknown'> | 'clear') {
  if (status === 'clear') {
    return {
      ...project,
      cultural_test_passed: project.cultural_test_passed.filter((code) => code !== countryCode),
      cultural_test_failed: project.cultural_test_failed.filter((code) => code !== countryCode),
    }
  }

  return {
    ...project,
    cultural_test_passed: status === 'pass'
      ? Array.from(new Set([...project.cultural_test_passed, countryCode]))
      : project.cultural_test_passed.filter((code) => code !== countryCode),
    cultural_test_failed: status === 'fail'
      ? Array.from(new Set([...project.cultural_test_failed, countryCode]))
      : project.cultural_test_failed.filter((code) => code !== countryCode),
  }
}

function getCulturalChecklist(inc: EligibleIncentive, project: ProjectInput): CulturalChecklistItem[] {
  const countryName = inc.country_name
  const countryCode = inc.country_code
  const hasLocalCreative =
    hasCountryName(project.director_nationalities, countryCode, countryName)
    || hasCountryName(project.producer_nationalities, countryCode, countryName)
    || hasCountryName(project.production_company_countries, countryCode, countryName)

  const hasLocalSubject =
    (project.subject_country || '').trim().toLowerCase() === countryCode.toLowerCase()
    || (project.subject_country || '').trim().toLowerCase() === countryName.toLowerCase()
    || (project.story_setting_country || '').trim().toLowerCase() === countryCode.toLowerCase()
    || (project.story_setting_country || '').trim().toLowerCase() === countryName.toLowerCase()

  const hasLocalProduction =
    hasShootInCountry(project, countryCode, countryName)
    || ((project.post_production_country || '').trim().toLowerCase() === countryCode.toLowerCase())
    || ((project.post_production_country || '').trim().toLowerCase() === countryName.toLowerCase())

  switch (countryCode) {
    case 'GB':
      return [
        {
          id: 'uk_story',
          label: 'The story, setting, or subject matter is meaningfully British.',
          help: 'Use this if the film is set in the UK, about British subjects, or materially tied to British culture.',
          defaultChecked: hasLocalSubject,
        },
        {
          id: 'uk_language',
          label: 'The work uses English or a recognized UK regional or minority language in a meaningful way.',
          defaultChecked: hasLanguage(project, 'english'),
        },
        {
          id: 'uk_creatives',
          label: 'You have British or qualifying European key creatives, producers, or company links that help the test.',
          defaultChecked: hasLocalCreative,
        },
        {
          id: 'uk_production',
          label: 'You are planning real UK production or post-production activity, not just a paper claim.',
          defaultChecked: hasLocalProduction,
        },
      ]
    case 'NO':
      return [
        {
          id: 'no_cultural',
          label: 'The project has clear Norwegian or wider European cultural content.',
          defaultChecked: hasLocalSubject,
        },
        {
          id: 'no_creatives',
          label: 'Key creative roles or rights ownership connect meaningfully to Norway or Europe.',
          defaultChecked: hasLocalCreative,
        },
        {
          id: 'no_production',
          label: 'A real part of the shoot, post, or vendor spend sits in Norway.',
          defaultChecked: hasLocalProduction,
        },
        {
          id: 'no_public_value',
          label: 'You can defend the project as culturally relevant, not just a service production.',
        },
      ]
    case 'IS':
      return [
        {
          id: 'is_cultural',
          label: 'The project has Icelandic or European cultural content that should score points.',
          defaultChecked: hasLocalSubject,
        },
        {
          id: 'is_creatives',
          label: 'Some key creative roles, companies, or rights links connect to Iceland or Europe.',
          defaultChecked: hasLocalCreative,
        },
        {
          id: 'is_production',
          label: 'There is real Icelandic production activity, not just a nominal claim.',
          defaultChecked: hasLocalProduction,
        },
        {
          id: 'is_supporting_elements',
          label: 'The language, talent mix, or setting gives you extra cultural points beyond the bare minimum.',
        },
      ]
    default:
      return [
        {
          id: 'generic_subject',
          label: `${countryName} subject matter, setting, or cultural content is genuinely present.`,
          defaultChecked: hasLocalSubject,
        },
        {
          id: 'generic_creative',
          label: `Key creatives, producers, or company structure have a real ${countryName} connection.`,
          defaultChecked: hasLocalCreative,
        },
        {
          id: 'generic_language',
          label: `Language, characters, or cultural references support a ${countryName} qualification argument.`,
        },
        {
          id: 'generic_production',
          label: `The production plan includes real work in ${countryName}, not only financing paperwork.`,
          defaultChecked: hasLocalProduction,
        },
      ]
  }
}

function RequirementList({ requirements }: { requirements: Requirement[] }) {
  return (
    <ul className="grid gap-3">
      {requirements.map((r, i) => (
        <li key={i} className="flex items-start gap-4 p-4 border border-neutral-100 bg-neutral-50/50">
          <ArrowRight size={16} className="mt-1 shrink-0 text-neutral-400" />
          <span className="text-neutral-700 font-medium">{r.description}</span>
        </li>
      ))}
    </ul>
  )
}

export function ScenarioList({ scenarios, project, budget, currency, onProjectUpdate, onReanalyze, onDocumentOpen }: Props) {
  if (scenarios.length === 0) return null

  return (
    <div className="space-y-8">
      {scenarios.map((scenario, idx) => (
        <ScenarioCard
          key={idx}
          scenario={scenario}
          project={project}
          index={idx}
          budget={budget}
          currency={currency}
          onProjectUpdate={onProjectUpdate}
          onReanalyze={onReanalyze}
          onDocumentOpen={onDocumentOpen}
        />
      ))}
    </div>
  )
}

function ScenarioCard({
  scenario,
  project,
  index,
  budget,
  currency,
  onProjectUpdate,
  onReanalyze,
  onDocumentOpen,
}: {
  scenario: Scenario
  project: ProjectInput
  index: number
  budget: number
  currency: string
  onProjectUpdate: (project: ProjectInput) => void
  onReanalyze: () => void
  onDocumentOpen?: DocOpenHandler
}) {
  const [open, setOpen] = useState(index === 0)

  const allIncentives = scenario.partners.flatMap((p) => p.eligible_incentives)
  const confirmedIncentives = allIncentives.filter((inc) => incentiveAmount(inc) > 0 && inc.counted_in_totals)
  const conditionalIncentives = allIncentives.filter((inc) => incentiveAmount(inc) > 0 && !inc.counted_in_totals)
  const strategicFunds = allIncentives.filter((inc) => incentiveAmount(inc) <= 0)

  const confirmedTotal = scenario.estimated_total_financing_amount
  const conditionalTotal = scenario.estimated_conditional_financing_amount
  const nearMissTotal = scenario.near_misses?.reduce((sum, nm) => sum + (nm.potential_benefit_amount || 0), 0) || 0

  const thresholdRequirements = scenario.requirements.filter((r) => ['budget', 'spend', 'shoot', 'region'].includes(r.category))
  const adminRequirements = scenario.requirements.filter((r) => !['budget', 'spend', 'shoot', 'region'].includes(r.category))

  return (
    <div className={`border-2 transition-all ${open ? 'border-black bg-white shadow-xl' : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-6 flex flex-wrap items-center justify-between gap-6 text-left"
      >
        <div className="flex items-center gap-6">
          <div className="h-12 w-12 flex items-center justify-center bg-black text-white font-bold text-xl">
            {index + 1}
          </div>
          <div>
            <h3 className="text-2xl font-bold tracking-tight">
              {scenario.partners.map((p) => p.country_name).join(' + ')}
            </h3>
            <p className="text-sm text-neutral-500 font-medium">
              Money you can model now: <span className="text-black font-bold">{fmt(confirmedTotal, currency)}</span> ({budgetPercent(confirmedTotal, budget)}% of budget)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-8">
          {conditionalTotal > 0 && (
            <div className="text-right px-4 border-r border-neutral-200">
              <span className="block text-[10px] font-black uppercase text-sky-700 tracking-widest">Possible Extra</span>
              <span className="text-lg font-bold text-sky-700">+{fmt(conditionalTotal, currency)}</span>
            </div>
          )}
          {nearMissTotal > 0 && (
            <div className="text-right px-4 border-r border-neutral-200">
              <span className="block text-[10px] font-black uppercase text-amber-600 tracking-widest">Almost There</span>
              <span className="text-lg font-bold text-amber-600">+{fmt(nearMissTotal, currency)}</span>
            </div>
          )}
          {open ? <ChevronUp /> : <ChevronDown />}
        </div>
      </button>

      {open && (
        <div className="border-t-2 border-neutral-100 p-8 space-y-12 animate-in fade-in slide-in-from-top-1">
          <div className="bg-neutral-50 p-6 border-l-4 border-black">
            <p className="text-lg leading-relaxed font-medium">"{scenario.rationale}"</p>
          </div>

          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <CheckCircle2 size={20} />
              </div>
              <h4 className="text-xl font-bold">Looks Usable Now</h4>
              <span className="text-sm text-neutral-400 font-medium">(The cleanest matches from the inputs you already gave)</span>
            </div>

            {confirmedIncentives.length > 0 ? (
              <div className="grid gap-4 pl-11">
                {confirmedIncentives.map((inc, i) => (
                  <IncentiveCard
                    key={i}
                    inc={inc}
                    project={project}
                    currency={currency}
                    accent="emerald"
                    onProjectUpdate={onProjectUpdate}
                    onReanalyze={onReanalyze}
                    onDocumentOpen={onDocumentOpen}
                  />
                ))}
              </div>
            ) : (
              <div className="pl-11">
                <div className="border border-neutral-200 bg-neutral-50 p-5 text-neutral-600">
                  Nothing here looks cleanly unlocked yet from the current inputs.
                </div>
              </div>
            )}
          </section>

          {conditionalIncentives.length > 0 && (
            <section className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center">
                  <AlertCircle size={20} />
                </div>
                <h4 className="text-xl font-bold">Could Work, But Not Yet</h4>
                <span className="text-sm text-neutral-400 font-medium">(Relevant options that still need a check, a partner, or a spending change)</span>
              </div>

              <div className="grid gap-4 pl-11">
                {conditionalIncentives.map((inc, i) => (
                  <div key={i} className="border border-sky-200 bg-sky-50/30 p-5 space-y-4">
                    <IncentiveCard
                      inc={inc}
                      project={project}
                      currency={currency}
                      accent="sky"
                      compact
                      onProjectUpdate={onProjectUpdate}
                      onReanalyze={onReanalyze}
                      onDocumentOpen={onDocumentOpen}
                    />
                    <div className="border border-sky-200 bg-white p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">What Still Needs To Be True</p>
                      <div className="mt-3">
                        <RequirementList requirements={inc.requirements} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {strategicFunds.length > 0 && (
            <section className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center">
                  <HelpCircle size={20} />
                </div>
                <h4 className="text-xl font-bold">Funds To Explore</h4>
                <span className="text-sm text-neutral-400 font-medium">(Relevant programmes, but not automatic cash rebates)</span>
              </div>

              <div className="grid gap-4 pl-11">
                {strategicFunds.map((inc, i) => (
                  <div key={i} className="border border-violet-200 bg-violet-50/20 p-5">
                    <p className="font-bold text-lg uppercase tracking-tight">{inc.name} ({inc.country_name})</p>
                    <p className="text-neutral-600 mt-1 max-w-xl">{inc.benefit?.benefit_explanation}</p>
                    <CulturalTestControl
                      inc={inc}
                      project={project}
                      onProjectUpdate={onProjectUpdate}
                      onReanalyze={onReanalyze}
                    />
                    {inc.requirements.length > 0 && (
                      <div className="mt-4">
                        <RequirementList requirements={inc.requirements} />
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {inc.benefit?.sources.map((s, idx) => (
                        <SourceBadge key={idx} source={s} onDocumentOpen={onDocumentOpen} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {scenario.near_misses && scenario.near_misses.length > 0 && (
            <section className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                  <AlertCircle size={20} />
                </div>
                <h4 className="text-xl font-bold">Almost There</h4>
                <span className="text-sm text-neutral-400 font-medium">(Options that are mainly being blocked by one threshold)</span>
              </div>

              <div className="grid gap-4 pl-11">
                {scenario.near_misses.map((nm, i) => (
                  <div key={i} className="border-2 border-amber-100 bg-amber-50/20 p-6">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <p className="font-bold text-lg uppercase tracking-tight text-amber-800">{nm.incentive_name}</p>
                        <p className="text-sm text-amber-700 font-medium">Gap: {nm.gap_category}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xl font-bold text-amber-600">+{fmt(nm.potential_benefit_amount || 0, nm.potential_benefit_currency || currency)}</span>
                        <span className="block text-xs font-bold text-neutral-400 mt-1">IF YOU FIX THIS GAP</span>
                      </div>
                    </div>

                    <div className="bg-white border border-amber-200 p-4 flex items-center gap-4">
                      <div className="bg-amber-600 text-white text-[10px] font-black px-2 py-1 uppercase">Gap</div>
                      <p className="font-bold text-neutral-800">{nm.gap_description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(thresholdRequirements.length > 0 || adminRequirements.length > 0) && (
            <section className="space-y-6 pt-6 border-t border-neutral-100">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-neutral-100 text-neutral-700 flex items-center justify-center">
                  <HelpCircle size={20} />
                </div>
                <h4 className="text-xl font-bold">What You Would Need To Change</h4>
                <span className="text-sm text-neutral-400 font-medium">(Grouped into budget/spend issues and practical next steps)</span>
              </div>

              {thresholdRequirements.length > 0 && (
                <div className="pl-11">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">Budget / Spend Problems</p>
                  <div className="mt-3">
                    <RequirementList requirements={thresholdRequirements} />
                  </div>
                </div>
              )}

              {adminRequirements.length > 0 && (
                <div className="pl-11">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">Practical Next Steps</p>
                  <div className="mt-3">
                    <RequirementList requirements={adminRequirements} />
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function IncentiveCard({
  inc,
  project,
  currency,
  accent,
  compact = false,
  onProjectUpdate,
  onReanalyze,
  onDocumentOpen,
}: {
  inc: EligibleIncentive
  project: ProjectInput
  currency: string
  accent: 'emerald' | 'sky'
  compact?: boolean
  onProjectUpdate: (project: ProjectInput) => void
  onReanalyze: () => void
  onDocumentOpen?: DocOpenHandler
}) {
  const amountColor = accent === 'emerald' ? 'text-emerald-600' : 'text-sky-700'

  return (
    <div className="border border-neutral-200 p-5 flex justify-between items-start gap-6">
      <div className="min-w-0">
        <p className="font-bold text-lg uppercase tracking-tight">{inc.name} ({inc.country_name})</p>
        <p className="text-neutral-500 mt-1 max-w-xl">{inc.benefit?.benefit_explanation}</p>
        <CulturalTestControl
          inc={inc}
          project={project}
          onProjectUpdate={onProjectUpdate}
          onReanalyze={onReanalyze}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {inc.benefit?.sources.map((s, idx) => (
            <SourceBadge key={idx} source={s} onDocumentOpen={onDocumentOpen} />
          ))}
        </div>
      </div>
      <div className="text-right shrink-0">
        <span className={`text-xl font-bold ${amountColor}`}>+{fmt(inc.benefit?.benefit_amount || 0, inc.benefit?.benefit_currency || currency)}</span>
        <span className="block text-xs font-bold text-neutral-400 mt-1">
          {compact ? 'MODELED AMOUNT' : `${inc.rebate_percent}% REBATE`}
        </span>
      </div>
    </div>
  )
}

function CulturalTestControl({
  inc,
  project,
  onProjectUpdate,
  onReanalyze,
}: {
  inc: EligibleIncentive
  project: ProjectInput
  onProjectUpdate: (project: ProjectInput) => void
  onReanalyze: () => void
}) {
  const [showChecklist, setShowChecklist] = useState(false)
  const status = getCulturalStatus(project, inc.country_code)

  const checklist = useMemo(() => getCulturalChecklist(inc, project), [inc, project])
  const [answers, setAnswers] = useState<Record<string, boolean>>(
    () => Object.fromEntries(checklist.map((item) => [item.id, Boolean(item.defaultChecked)])),
  )

  if (!incentiveNeedsCulturalTest(inc)) return null

  const thresholdText = requirementThresholdText(inc)
  const checkedCount = checklist.filter((item) => answers[item.id]).length

  const applyStatus = (nextStatus: Exclude<CulturalStatus, 'unknown'> | 'clear') => {
    onProjectUpdate(buildUpdatedProject(project, inc.country_code, nextStatus))
    setShowChecklist(false)
    onReanalyze()
  }

  const handleSelect = (value: string) => {
    if (value === 'review') {
      setShowChecklist(true)
      return
    }
    if (value === 'pass' || value === 'fail') {
      applyStatus(value)
    }
  }

  return (
    <div className="mt-4 border border-neutral-200 bg-neutral-50/70 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-black uppercase tracking-wider text-neutral-500">
            Cultural Test
          </p>
          <p className="text-sm font-medium text-neutral-700">
            {status === 'pass' && `${inc.country_name} cultural test marked as passed.`}
            {status === 'fail' && `${inc.country_name} cultural test marked as failed.`}
            {status === 'unknown' && 'This result depends on a cultural test review.'}
          </p>
          {thresholdText && (
            <p className="text-xs text-neutral-500 max-w-xl">{thresholdText}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <select
            value={showChecklist && status === 'unknown' ? 'review' : status === 'unknown' ? '' : status}
            onChange={(e) => handleSelect(e.target.value)}
            className="input bg-white min-w-[240px]"
          >
            <option value="">Do you pass this cultural test?</option>
            <option value="pass">We pass</option>
            <option value="fail">We fail</option>
            <option value="review">Check now</option>
          </select>

          {status !== 'unknown' && (
            <button
              type="button"
              onClick={() => applyStatus('clear')}
              className="p-2 text-neutral-400 hover:text-gallery-accent transition-colors"
              title="Reset cultural test status"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {showChecklist && (
        <div className="border border-neutral-200 bg-white p-4 space-y-4">
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-wider text-neutral-500">
              Quick Self-Check For {inc.country_name}
            </p>
            <p className="text-sm text-neutral-600 max-w-2xl">
              Tick the boxes that are genuinely true for this project. This is a guided producer check, not an official filing form.
            </p>
          </div>

          <div className="grid gap-3">
            {checklist.map((item) => (
              <label key={item.id} className="flex items-start gap-3 border border-neutral-100 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(answers[item.id])}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                  className="mt-1"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-neutral-800">{item.label}</span>
                  {item.help && <span className="block text-xs text-neutral-500">{item.help}</span>}
                </span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-neutral-100 pt-4">
            <p className="text-xs text-neutral-500">
              Checked: <span className="font-bold text-neutral-800">{checkedCount} / {checklist.length}</span>
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => applyStatus('fail')}
                className="text-[10px] font-black tracking-widest px-3 py-1.5 border border-neutral-200 hover:border-red-500 hover:text-red-600 transition-all uppercase"
              >
                Mark Fail
              </button>
              <button
                type="button"
                onClick={() => applyStatus('pass')}
                className="text-[10px] font-black tracking-widest px-4 py-1.5 bg-gallery-text text-white hover:bg-gallery-accent transition-all uppercase"
              >
                Mark Pass
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
