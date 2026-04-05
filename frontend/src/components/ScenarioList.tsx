import { useEffect, useMemo, useState } from 'react'
import type { Scenario, EligibleIncentive, Requirement, ProjectInput, SourceReference } from '../types'
import { SourceBadge } from './SourceLink'
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, ArrowRight, HelpCircle, RotateCcw } from 'lucide-react'

type DocOpenHandler = (documentId: number, annotationId?: number | null) => void
type CulturalStatus = 'unknown' | 'pass' | 'fail'
type CulturalAnswer = boolean | string

interface Props {
  scenarios: Scenario[]
  project: ProjectInput
  budget: number
  currency: string
  onProjectUpdate: (project: ProjectInput) => void
  onReanalyze: () => void
  onDocumentOpen?: DocOpenHandler
}

interface CulturalQuestionOption {
  value: string
  label: string
}

interface CulturalQuestion {
  id: string
  label: string
  type: 'boolean' | 'select'
  help?: string
  options?: CulturalQuestionOption[]
  defaultValue: CulturalAnswer
}

interface CulturalAssessmentSection {
  label: string
  score: number
  max: number
}

interface CulturalAssessmentResult {
  score: number
  sections: CulturalAssessmentSection[]
}

interface CulturalAssessment {
  mode: 'scored' | 'guided'
  title: string
  intro: string
  thresholdText?: string
  passMark: number
  totalPoints: number
  passLabel: string
  failLabel: string
  applyLabel: string
  sources?: SourceReference[]
  questions: CulturalQuestion[]
  evaluate: (answers: Record<string, CulturalAnswer>) => CulturalAssessmentResult
}

function source(url: string, description: string, clause_reference?: string): SourceReference {
  return { url, description, clause_reference }
}

function countYes(answers: Record<string, CulturalAnswer>, ids: string[]) {
  return ids.reduce((sum, id) => sum + (answers[id] ? 1 : 0), 0)
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

function incentiveLocationLabel(inc: EligibleIncentive) {
  return inc.region ? `${inc.region}, ${inc.country_name}` : inc.country_name
}

function incentiveHeadlineLabel(inc: EligibleIncentive) {
  if (inc.rebate_percent) return `${inc.rebate_percent}% REBATE`
  return inc.incentive_type.replace(/_/g, ' ').toUpperCase()
}

function countryAliases(countryCode: string, countryName: string) {
  const aliases = new Set([countryCode.trim().toLowerCase(), countryName.trim().toLowerCase()])

  if (countryCode.toUpperCase() === 'GB') {
    ;['uk', 'u.k.', 'united kingdom', 'britain', 'great britain', 'british', 'england', 'scotland', 'wales', 'northern ireland'].forEach((alias) => aliases.add(alias))
  }

  return aliases
}

function hasCountryName(values: string[] | undefined, countryCode: string, countryName: string) {
  const aliases = countryAliases(countryCode, countryName)
  return (values || []).some((value) => {
    const normalized = value.trim().toLowerCase()
    return aliases.has(normalized)
  })
}

function hasShootInCountry(project: ProjectInput, countryCode: string, countryName: string) {
  const aliases = countryAliases(countryCode, countryName)
  return project.shoot_locations.some((loc) => {
    const normalized = loc.country.trim().toLowerCase()
    return aliases.has(normalized)
  })
}

function hasLanguage(project: ProjectInput, language: string) {
  return project.languages.some((entry) => entry.trim().toLowerCase() === language.toLowerCase())
}

function matchesCountryField(value: string | undefined, countryCode: string, countryName: string) {
  if (!value) return false
  return countryAliases(countryCode, countryName).has(value.trim().toLowerCase())
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

function buildGenericCulturalAssessment(inc: EligibleIncentive, project: ProjectInput): CulturalAssessment {
  const countryName = inc.country_name
  const countryCode = inc.country_code
  const hasLocalCreative =
    hasCountryName(project.director_nationalities, countryCode, countryName)
    || hasCountryName(project.producer_nationalities, countryCode, countryName)
    || hasCountryName(project.production_company_countries, countryCode, countryName)

  const hasLocalSubject =
    matchesCountryField(project.subject_country, countryCode, countryName)
    || matchesCountryField(project.story_setting_country, countryCode, countryName)

  const hasLocalProduction =
    hasShootInCountry(project, countryCode, countryName)
    || matchesCountryField(project.post_production_country, countryCode, countryName)

  const questions: CulturalQuestion[] = [
    {
      id: 'subject',
      label: `Is the story, setting, real-life subject or source material meaningfully connected to ${countryName}?`,
      help: 'Use yes if the project would clearly read as culturally tied to this country, not just financed there.',
      type: 'boolean',
      defaultValue: hasLocalSubject,
    },
    {
      id: 'creatives',
      label: `Do key creatives or producers have a real ${countryName} connection?`,
      help: 'Usually this means the director, producer or company is from there or genuinely based there.',
      type: 'boolean',
      defaultValue: hasLocalCreative,
    },
    {
      id: 'production',
      label: `Will real production or post-production work happen in ${countryName}?`,
      type: 'boolean',
      defaultValue: hasLocalProduction,
    },
    {
      id: 'language',
      label: `Do the language, characters or cultural references support a ${countryName} claim?`,
      type: 'boolean',
      defaultValue: false,
    },
  ]

  return {
    mode: 'guided',
    title: `${countryName} cultural self-check`,
    intro: 'This is a preliminary producer check, not an official scoring sheet. Use it to judge whether the project has a believable cultural fit before you do a proper filing.',
    thresholdText: requirementThresholdText(inc),
    passMark: 3,
    totalPoints: 4,
    passLabel: 'Likely strong enough',
    failLabel: 'Needs a stronger case',
    applyLabel: 'Use This Estimate',
    sources: inc.requirements.flatMap((requirement) => requirement.source ? [requirement.source] : []),
    questions,
    evaluate: (answers) => {
      const score = questions.reduce((sum, question) => sum + (answers[question.id] ? 1 : 0), 0)
      return {
        score,
        sections: [{ label: 'Core fit', score, max: 4 }],
      }
    },
  }
}

function buildUkCulturalAssessment(project: ProjectInput): CulturalAssessment {
  const hasUkCreative =
    hasCountryName(project.director_nationalities, 'GB', 'United Kingdom')
    || hasCountryName(project.producer_nationalities, 'GB', 'United Kingdom')
    || hasCountryName(project.production_company_countries, 'GB', 'United Kingdom')

  const hasUkSubject =
    matchesCountryField(project.subject_country, 'GB', 'United Kingdom')
    || matchesCountryField(project.story_setting_country, 'GB', 'United Kingdom')

  const questions: CulturalQuestion[] = [
    {
      id: 'setting',
      label: 'Where is the story mainly set?',
      type: 'select',
      defaultValue: hasUkSubject ? 'uk' : 'outside',
      options: [
        { value: 'uk', label: 'Mainly in the UK' },
        { value: 'eea', label: 'Mainly in another EEA country' },
        { value: 'mixed', label: 'Split across the UK / EEA' },
        { value: 'outside', label: 'Mainly outside the UK / EEA' },
      ],
    },
    {
      id: 'lead_characters',
      label: 'How many lead characters are British, UK-based or otherwise from the UK / EEA?',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'one', label: 'One' },
        { value: 'two_plus', label: 'Two or more' },
      ],
    },
    {
      id: 'british_connection',
      label: 'Does the story have a meaningful British connection?',
      help: 'Examples: British history, British institutions, British communities, British source material, or a real-life subject strongly tied to Britain.',
      type: 'select',
      defaultValue: hasUkSubject ? 'strong' : 'none',
      options: [
        { value: 'strong', label: 'Yes, clearly' },
        { value: 'some', label: 'Somewhat' },
        { value: 'none', label: 'No' },
      ],
    },
    {
      id: 'dialogue',
      label: 'What best describes the dialogue?',
      type: 'select',
      defaultValue: hasLanguage(project, 'english') ? 'english' : 'other',
      options: [
        { value: 'english', label: 'Mainly English or a UK indigenous language' },
        { value: 'eea', label: 'Mainly another EEA language' },
        { value: 'mixed', label: 'Mixed, but a meaningful amount is English / UK / EEA' },
        { value: 'other', label: 'Mostly outside that group' },
      ],
    },
    {
      id: 'contribution',
      label: 'Does the film clearly reflect British creativity, heritage or diversity?',
      type: 'select',
      defaultValue: hasUkSubject ? 'strong' : 'none',
      options: [
        { value: 'strong', label: 'Yes, strongly' },
        { value: 'some', label: 'A bit' },
        { value: 'none', label: 'No' },
      ],
    },
    {
      id: 'principal_photography',
      label: 'How much of principal photography or SFX happens in the UK?',
      type: 'select',
      defaultValue: hasShootInCountry(project, 'GB', 'United Kingdom') ? 'some' : 'none',
      options: [
        { value: 'none', label: 'Under 50%' },
        { value: 'some', label: '50% to 79%' },
        { value: 'majority', label: '80% or more' },
      ],
    },
    {
      id: 'vfx',
      label: 'How much of the VFX happens in the UK?',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'Under 50%' },
        { value: 'some', label: '50% or more' },
      ],
    },
    {
      id: 'post',
      label: 'Will music recording, audio post or picture post happen in the UK?',
      type: 'boolean',
      defaultValue: matchesCountryField(project.post_production_country, 'GB', 'United Kingdom'),
    },
    {
      id: 'director',
      label: 'Is at least one lead director British / UK-based or otherwise from the UK / EEA?',
      type: 'boolean',
      defaultValue: hasCountryName(project.director_nationalities, 'GB', 'United Kingdom'),
    },
    {
      id: 'writer',
      label: 'Is at least one lead writer British / UK-based or otherwise from the UK / EEA?',
      type: 'boolean',
      defaultValue: false,
    },
    {
      id: 'producer',
      label: 'Is at least one lead producer British / UK-based or otherwise from the UK / EEA?',
      type: 'boolean',
      defaultValue: hasCountryName(project.producer_nationalities, 'GB', 'United Kingdom') || hasUkCreative,
    },
    {
      id: 'composer',
      label: 'Is at least one lead composer British / UK-based or otherwise from the UK / EEA?',
      type: 'boolean',
      defaultValue: false,
    },
    {
      id: 'lead_actor',
      label: 'Is at least one lead actor British / UK-based or otherwise from the UK / EEA?',
      type: 'boolean',
      defaultValue: false,
    },
    {
      id: 'cast',
      label: 'Are at least 50% of the cast British / UK-based or otherwise from the UK / EEA?',
      type: 'boolean',
      defaultValue: false,
    },
    {
      id: 'hod',
      label: 'Is at least one key head of department British / UK-based or otherwise from the UK / EEA?',
      help: 'For example: cinematography, production design, costume, editing, sound, VFX supervision, or hair and make-up.',
      type: 'boolean',
      defaultValue: false,
    },
    {
      id: 'crew',
      label: 'Are at least 50% of the crew British / UK-based or otherwise from the UK / EEA?',
      type: 'boolean',
      defaultValue: false,
    },
  ]

  return {
    mode: 'scored',
    title: 'UK film cultural test self-check',
    intro: 'Based on the BFI film cultural test. A project needs 18 out of 35 points to pass.',
    thresholdText: 'BFI requires 18 out of 35 points for the UK film cultural test.',
    passMark: 18,
    totalPoints: 35,
    passLabel: 'Pass',
    failLabel: 'Not enough points yet',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://www.bfi.org.uk/apply-british-certification-expenditure-credits/cultural-test-film', 'BFI film cultural test'),
      source('https://www.bfi.org.uk/apply-british-certification-expenditure-credits/cultural-test-film/summary-points-cultural-test-film', 'BFI summary of points', '18/35 points'),
    ],
    questions,
    evaluate: (answers) => {
      const sectionA =
        ({ uk: 4, eea: 4, mixed: 2, outside: 0 }[String(answers.setting)] || 0)
        + ({ none: 0, one: 1, two_plus: 4 }[String(answers.lead_characters)] || 0)
        + ({ strong: 4, some: 2, none: 0 }[String(answers.british_connection)] || 0)
        + ({ english: 6, eea: 6, mixed: 3, other: 0 }[String(answers.dialogue)] || 0)

      const sectionB = ({ strong: 4, some: 2, none: 0 }[String(answers.contribution)] || 0)

      const photographyPoints = ({ none: 0, some: 2, majority: 4 }[String(answers.principal_photography)] || 0)
      const vfxPoints = ({ none: 0, some: 2 }[String(answers.vfx)] || 0)
      const sectionC = Math.min(4, photographyPoints + vfxPoints) + (answers.post ? 1 : 0)

      const sectionD = [
        'director',
        'writer',
        'producer',
        'composer',
        'lead_actor',
        'cast',
        'hod',
        'crew',
      ].reduce((sum, key) => sum + (answers[key] ? 1 : 0), 0)

      return {
        score: sectionA + sectionB + sectionC + sectionD,
        sections: [
          { label: 'Cultural content', score: sectionA, max: 18 },
          { label: 'Cultural contribution', score: sectionB, max: 4 },
          { label: 'Cultural hubs', score: sectionC, max: 5 },
          { label: 'Cultural practitioners', score: sectionD, max: 8 },
        ],
      }
    },
  }
}

function buildIrelandAssessment(project: ProjectInput): CulturalAssessment {
  const hasIrishCreative =
    hasCountryName(project.director_nationalities, 'IE', 'Ireland')
    || hasCountryName(project.producer_nationalities, 'IE', 'Ireland')
    || hasCountryName(project.production_company_countries, 'IE', 'Ireland')

  const questions: CulturalQuestion[] = [
    {
      id: 'official_copro',
      label: 'Will the project qualify as an official co-production instead of relying on the cultural test route?',
      type: 'boolean',
      defaultValue: hasCountryName(project.has_coproducer, 'IE', 'Ireland'),
    },
    {
      id: 'cultural_connection',
      label: 'Does the project clearly support Irish or European culture through its story, subject, characters or source material?',
      type: 'boolean',
      defaultValue:
        matchesCountryField(project.subject_country, 'IE', 'Ireland')
        || matchesCountryField(project.story_setting_country, 'IE', 'Ireland'),
    },
    {
      id: 'industry_development',
      label: 'Will the project make a meaningful contribution to Irish industry development through Irish creatives, crew, training or company growth?',
      type: 'boolean',
      defaultValue: hasIrishCreative,
    },
    {
      id: 'irish_activity',
      label: 'Will there be real production, VFX or post-production activity in Ireland with qualifying Irish spend?',
      type: 'boolean',
      defaultValue:
        hasShootInCountry(project, 'IE', 'Ireland')
        || matchesCountryField(project.post_production_country, 'IE', 'Ireland'),
    },
  ]

  return {
    mode: 'guided',
    title: 'Ireland Section 481 qualification check',
    intro: 'Section 481 can qualify through the cultural test, the industry development test, or official co-production status. This check mirrors those published routes instead of asking you to guess pass or fail.',
    thresholdText: 'Official co-production status qualifies on its own. Otherwise you need a strong Section 481 case on the cultural or industry-development route.',
    passMark: 2,
    totalPoints: 3,
    passLabel: 'Likely viable',
    failLabel: 'Needs a clearer Irish qualification route',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://www.gov.ie/en/department-of-culture-communications-and-sport/services/how-to-qualify-for-the-film-corporation-tax-relief/', 'gov.ie Section 481 qualification route'),
      source('https://www.revenue.ie/en/companies-and-charities/reliefs-and-exemptions/film-relief/index.aspx', 'Revenue.ie Film Relief (Section 481)', 'Qualification via cultural test, industry development test, or official coproduction status'),
    ],
    questions,
    evaluate: (answers) => {
      if (answers.official_copro) {
        return {
          score: 3,
          sections: [{ label: 'Qualification route', score: 3, max: 3 }],
        }
      }

      const score = countYes(answers, ['cultural_connection', 'industry_development', 'irish_activity'])
      return {
        score,
        sections: [{ label: 'Qualification route', score, max: 3 }],
      }
    },
  }
}

function buildHungaryAssessment(project: ProjectInput): CulturalAssessment {
  const questions: CulturalQuestion[] = [
    {
      id: 'european_content',
      label: 'Does the film clearly contain European content or cultural values?',
      type: 'boolean',
      defaultValue:
        matchesCountryField(project.subject_country, 'HU', 'Hungary')
        || matchesCountryField(project.story_setting_country, 'HU', 'Hungary'),
    },
    {
      id: 'eu_creatives',
      label: 'Are the key creatives mainly EU or EEA nationals or residents?',
      help: 'The NFI summary says additional points are granted when EU nationals are making the movie.',
      type: 'boolean',
      defaultValue:
        project.director_nationalities.length > 0
        || project.producer_nationalities.length > 0,
    },
    {
      id: 'eu_finance',
      label: 'Is the financing or producing structure meaningfully European rather than only offshore?',
      type: 'boolean',
      defaultValue: hasCountryName(project.production_company_countries, 'HU', 'Hungary'),
    },
    {
      id: 'hungary_activity',
      label: 'Will there be real production or post-production activity in Hungary with a Hungarian producer or service company?',
      type: 'boolean',
      defaultValue:
        hasShootInCountry(project, 'HU', 'Hungary')
        || matchesCountryField(project.post_production_country, 'HU', 'Hungary'),
    },
  ]

  return {
    mode: 'guided',
    title: 'Hungary cultural test self-check',
    intro: 'The English NFI guidance publicly describes the Hungarian test at a high level: European content or cultural values are required, and extra points are given when EU nationals are making or financing the film.',
    thresholdText: 'The current NFI English guidance says 16 points are required to pass the Hungarian cultural test.',
    passMark: 3,
    totalPoints: 4,
    passLabel: 'Likely viable',
    failLabel: 'Needs a stronger European / Hungarian case',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://nfi.hu/en/filming-in-hungary/hungarian-film-incentive', 'NFI Hungary film incentive', 'Cultural test summary'),
    ],
    questions,
    evaluate: (answers) => {
      const score = countYes(answers, ['european_content', 'eu_creatives', 'eu_finance', 'hungary_activity'])
      return {
        score,
        sections: [{ label: 'Published criteria', score, max: 4 }],
      }
    },
  }
}

function buildPolandAssessment(project: ProjectInput): CulturalAssessment {
  const questions: CulturalQuestion[] = [
    {
      id: 'cultural_achievement',
      label: 'Does the work use Polish or European cultural heritage, history or identity in a meaningful way?',
      type: 'boolean',
      defaultValue:
        matchesCountryField(project.subject_country, 'PL', 'Poland')
        || matchesCountryField(project.story_setting_country, 'PL', 'Poland'),
    },
    {
      id: 'polish_setting',
      label: 'Is the action located in Poland or does the project materially represent Poland?',
      type: 'boolean',
      defaultValue: matchesCountryField(project.story_setting_country, 'PL', 'Poland'),
    },
    {
      id: 'polish_production',
      label: 'Is the work genuinely being produced in Poland rather than only claiming the rebate on paper?',
      type: 'boolean',
      defaultValue: hasShootInCountry(project, 'PL', 'Poland'),
    },
    {
      id: 'polish_workers',
      label: 'Will Polish workers, collaborators or service providers be materially involved?',
      type: 'boolean',
      defaultValue:
        hasCountryName(project.director_nationalities, 'PL', 'Poland')
        || hasCountryName(project.producer_nationalities, 'PL', 'Poland')
        || (project.local_crew_percent || 0) >= 30,
    },
    {
      id: 'polish_infrastructure',
      label: 'Will the project materially use Polish film infrastructure, studios, post, or local facilities?',
      type: 'boolean',
      defaultValue:
        hasShootInCountry(project, 'PL', 'Poland')
        || matchesCountryField(project.post_production_country, 'PL', 'Poland'),
    },
  ]

  return {
    mode: 'guided',
    title: 'Poland qualification test self-check',
    intro: 'PISF publishes the qualification-test buckets on its application page. This simplified version follows those public buckets and gives a conservative read before you fill in the full form.',
    thresholdText: 'PISF says the audiovisual work must obtain at least 51% of the available qualification-test points.',
    passMark: 3,
    totalPoints: 5,
    passLabel: 'Likely enough on the published criteria',
    failLabel: 'Needs a stronger Polish case',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://pisf.pl/zachety-wnioski/', 'PISF application guidance', 'Qualification test and 51% threshold'),
    ],
    questions,
    evaluate: (answers) => {
      const score = countYes(answers, questions.map((question) => question.id))
      return {
        score,
        sections: [{ label: 'Public criteria buckets', score, max: 5 }],
      }
    },
  }
}

function buildCroatiaAssessment(project: ProjectInput): CulturalAssessment {
  const questions: CulturalQuestion[] = [
    { id: 'content_history', label: 'Is the theme based on Croatian, European or world culture, history, mythology, religion, or a coherent past/future world?', type: 'boolean', defaultValue: false },
    { id: 'content_setting', label: 'Is the work set in Croatia or Europe, or does it materially represent a Croatian or European cultural environment?', type: 'boolean', defaultValue: matchesCountryField(project.story_setting_country, 'HR', 'Croatia') },
    { id: 'content_adaptation', label: 'Is it inspired by or adapted from an existing literary, musical, theatrical or audiovisual work?', type: 'boolean', defaultValue: false },
    { id: 'content_topics', label: 'Does it deal with contemporary political, social or cultural topics?', type: 'boolean', defaultValue: false },
    { id: 'content_language', label: 'Will the final version be in Croatian or another European language?', type: 'boolean', defaultValue: hasLanguage(project, 'english') },
    { id: 'content_artist', label: 'Does a contemporary artist from another discipline make an essential contribution to the work?', type: 'boolean', defaultValue: false },
    { id: 'director', label: 'Is the director Croatian or another EEA national?', type: 'boolean', defaultValue: hasCountryName(project.director_nationalities, 'HR', 'Croatia') },
    { id: 'producer', label: 'Is the producer Croatian or another EEA national?', type: 'boolean', defaultValue: hasCountryName(project.producer_nationalities, 'HR', 'Croatia') },
    { id: 'coauthor', label: 'Is at least one co-author Croatian or another EEA national?', help: 'Examples in the regulation include scriptwriter, dialogue writer, cinematographer, chief animator, layout artist or composer.', type: 'boolean', defaultValue: false },
    {
      id: 'hod_count',
      label: 'How many key department heads are Croatian or another EEA national?',
      help: 'Examples: art direction, costume, editing, sound, camera, AD, set design, hair/makeup, VFX, or unit/floor management.',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'one', label: 'One' },
        { value: 'two_to_four', label: 'Two to four' },
        { value: 'five_plus', label: 'Five or more' },
      ],
    },
    { id: 'lead_actor', label: 'Is at least one lead actor or lead voice performer Croatian or another EEA national?', type: 'boolean', defaultValue: false },
    { id: 'supporting_cast', label: 'Are at least three supporting actors or voice performers Croatian or another EEA national?', type: 'boolean', defaultValue: false },
    { id: 'intern', label: 'Will you employ at least one intern in a main department?', type: 'boolean', defaultValue: false },
    {
      id: 'crew_share',
      label: 'What share of the Croatian crew are Croatian or other EEA nationals?',
      type: 'select',
      defaultValue: (project.local_crew_percent || 0) >= 50 ? 'fifty' : (project.local_crew_percent || 0) >= 40 ? 'forty' : (project.local_crew_percent || 0) >= 30 ? 'thirty' : 'under_thirty',
      options: [
        { value: 'under_thirty', label: 'Under 30%' },
        { value: 'thirty', label: '30% to 39%' },
        { value: 'forty', label: '40% to 49%' },
        { value: 'fifty', label: '50% or more' },
      ],
    },
    {
      id: 'croatia_days',
      label: 'How much filming, production or post-production happens in Croatia?',
      type: 'select',
      defaultValue: hasShootInCountry(project, 'HR', 'Croatia') || matchesCountryField(project.post_production_country, 'HR', 'Croatia') ? 'thirty' : 'under_fifteen',
      options: [
        { value: 'under_fifteen', label: 'Under 15%' },
        { value: 'fifteen', label: '15% to 29%' },
        { value: 'thirty', label: '30% to 49%' },
        { value: 'fifty', label: '50% or more' },
      ],
    },
    {
      id: 'croatian_services',
      label: 'How much of the Croatian spend is paid to Croatian service providers?',
      type: 'select',
      defaultValue: 'under_fifteen',
      options: [
        { value: 'under_fifteen', label: 'Under 15%' },
        { value: 'fifteen', label: '15% to 29%' },
        { value: 'thirty', label: '30% to 49%' },
        { value: 'fifty', label: '50% or more' },
      ],
    },
  ]

  return {
    mode: 'scored',
    title: 'Croatia co-production qualification test',
    intro: 'This follows Appendix 1 of the 2024 Croatian cash-rebate regulation for co-productions.',
    thresholdText: 'Croatia Appendix 1 requires 22/44 points, including at least 6 points in cultural content, 10 in human resources, and 6 in Croatian production resources.',
    passMark: 22,
    totalPoints: 44,
    passLabel: 'Pass',
    failLabel: 'Not enough points yet',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://filmingincroatia.hr/wp-content/uploads/2025/10/REGULATIONS_FILMING-IN-CROATIA-2024.pdf', 'Croatia cash rebate regulation 2024', 'Appendix 1, co-production qualification test'),
    ],
    questions,
    evaluate: (answers) => {
      const sectionA = countYes(answers, ['content_history', 'content_setting', 'content_adaptation', 'content_topics', 'content_language', 'content_artist']) * 2

      const sectionB =
        (answers.director ? 1 : 0)
        + (answers.producer ? 1 : 0)
        + (answers.coauthor ? 1 : 0)
        + ({ none: 0, one: 2, two_to_four: 4, five_plus: 7 }[String(answers.hod_count)] || 0)
        + (answers.lead_actor ? 1 : 0)
        + (answers.supporting_cast ? 1 : 0)
        + (answers.intern ? 2 : 0)
        + ({ under_thirty: 0, thirty: 3, forty: 4, fifty: 6 }[String(answers.crew_share)] || 0)

      const sectionC =
        ({ under_fifteen: 0, fifteen: 2, thirty: 3, fifty: 5 }[String(answers.croatia_days)] || 0)
        + ({ under_fifteen: 0, fifteen: 3, thirty: 5, fifty: 7 }[String(answers.croatian_services)] || 0)

      return {
        score: sectionA + sectionB + sectionC,
        sections: [
          { label: 'Cultural content', score: sectionA, max: 12 },
          { label: 'Human resources', score: sectionB, max: 20 },
          { label: 'Croatian resources', score: sectionC, max: 12 },
        ],
      }
    },
  }
}

function buildIcelandAssessment(project: ProjectInput): CulturalAssessment {
  const questions: CulturalQuestion[] = [
    { id: 'culture_history', label: 'Is the story based on Icelandic or European culture, history, mythology or religion?', type: 'boolean', defaultValue: false },
    { id: 'character', label: 'Is it based on a character or personality from Icelandic or European culture, history, society or religion?', type: 'boolean', defaultValue: false },
    { id: 'setting', label: 'Is the storyline connected to an Icelandic or European setting, place, location or cultural environment?', type: 'boolean', defaultValue: matchesCountryField(project.story_setting_country, 'IS', 'Iceland') },
    { id: 'adaptation', label: 'Is it based on a literary work or another culturally important art form?', type: 'boolean', defaultValue: false },
    { id: 'current_themes', label: 'Does it focus on current cultural, sociological or political themes in Icelandic or European society?', type: 'boolean', defaultValue: false },
    { id: 'values', label: 'Does it reflect Icelandic or European values such as diversity, equality, minority rights, tolerance or environmental protection?', type: 'boolean', defaultValue: false },
    { id: 'identity', label: 'Does it focus on Icelandic or European culture, identity, customs or traditions?', type: 'boolean', defaultValue: false },
    { id: 'historical_events', label: 'Is it based on current or historical events affecting Icelandic or European society?', type: 'boolean', defaultValue: false },
    { id: 'genre_value', label: 'Will the film contribute to the development of its genre?', type: 'boolean', defaultValue: false },
    { id: 'ambition', label: 'Is it the kind of ambitious, culturally valuable project that builds filmmaking capacity?', type: 'boolean', defaultValue: false },
    {
      id: 'role_count',
      label: 'How many of these roles are Icelandic or EEA nationals: director, producer, DOP, assistant DOP, writer, lead actor, supporting actor, composer, production designer, costume designer, editor, makeup artist, line producer, post/VFX supervisor?',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'one_to_four', label: 'One to four' },
        { value: 'five_to_nine', label: 'Five to nine' },
        { value: 'ten_plus', label: 'Ten or more' },
      ],
    },
    { id: 'eea_language', label: 'Will the final version be in an EEA language?', type: 'boolean', defaultValue: hasLanguage(project, 'english') },
    { id: 'crew_eea', label: 'Will at least 51% of the crew be citizens of EEA countries?', type: 'boolean', defaultValue: false },
    {
      id: 'shooting',
      label: 'How much of the shoot happens in Iceland?',
      type: 'select',
      defaultValue: hasShootInCountry(project, 'IS', 'Iceland') ? 'some' : 'none',
      options: [
        { value: 'none', label: 'Very little or none' },
        { value: 'some', label: 'A meaningful amount' },
        { value: 'majority', label: 'Most of it' },
      ],
    },
    {
      id: 'service_providers',
      label: 'How much of the production uses Icelandic service providers in Iceland?',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'Very little or none' },
        { value: 'some', label: 'A meaningful amount' },
        { value: 'majority', label: 'Most of it' },
      ],
    },
    {
      id: 'post',
      label: 'How much of post-production happens in Iceland or the EEA?',
      type: 'select',
      defaultValue: matchesCountryField(project.post_production_country, 'IS', 'Iceland') ? 'majority' : 'none',
      options: [
        { value: 'none', label: 'Very little or none' },
        { value: 'some', label: 'A meaningful amount' },
        { value: 'majority', label: 'Most of it' },
      ],
    },
  ]

  return {
    mode: 'scored',
    title: 'Iceland cultural test self-check',
    intro: 'This follows the Icelandic project-evaluation translation used for the reimbursement scheme.',
    thresholdText: 'Iceland requires at least 4 points from Part I cultural criteria and at least 23 points overall out of 46.',
    passMark: 23,
    totalPoints: 46,
    passLabel: 'Pass',
    failLabel: 'Not enough points yet',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://www.government.is/media/atvinnuvegaraduneyti-media/media/Acrobat/Filmreimbursements_Iceland_Culturaltest.pdf', 'Government of Iceland cultural test', 'Part I-III'),
    ],
    questions,
    evaluate: (answers) => {
      const sectionA = countYes(answers, ['culture_history', 'character', 'setting', 'adaptation', 'current_themes', 'values', 'identity', 'historical_events']) * 2

      const sectionB =
        (answers.genre_value ? 3 : 0)
        + (answers.ambition ? 4 : 0)
        + ({ none: 0, one_to_four: 1, five_to_nine: 2, ten_plus: 3 }[String(answers.role_count)] || 0)
        + (answers.eea_language ? 4 : 0)
        + (answers.crew_eea ? 4 : 0)
        + ({ none: 0, some: 2, majority: 4 }[String(answers.shooting)] || 0)
        + ({ none: 0, some: 2, majority: 4 }[String(answers.service_providers)] || 0)
        + ({ none: 0, some: 2, majority: 4 }[String(answers.post)] || 0)

      return {
        score: sectionA + sectionB,
        sections: [
          { label: 'Cultural criteria', score: sectionA, max: 16 },
          { label: 'Production criteria', score: sectionB, max: 30 },
        ],
      }
    },
  }
}

function buildNorwayAssessment(project: ProjectInput): CulturalAssessment {
  const questions: CulturalQuestion[] = [
    { id: 'culture_history', label: 'Is the story based on Norwegian or European culture or history?', type: 'boolean', defaultValue: false },
    { id: 'character', label: 'Is it based on a character or personality from Norwegian or European culture, history or society?', type: 'boolean', defaultValue: false },
    { id: 'setting', label: 'Is the story connected with a Norwegian or European setting, place or cultural environment?', type: 'boolean', defaultValue: matchesCountryField(project.story_setting_country, 'NO', 'Norway') },
    { id: 'adaptation', label: 'Is it based on literature or another artistic discipline?', type: 'boolean', defaultValue: false },
    { id: 'current_themes', label: 'Does it focus on current cultural, sociological or political themes or events?', type: 'boolean', defaultValue: false },
    { id: 'values', label: 'Does it reflect Norwegian or European values, culture, identity, customs or traditions?', type: 'boolean', defaultValue: false },
    { id: 'writer_director', label: 'Is the director, writer or literary author Norwegian or European?', type: 'boolean', defaultValue: hasCountryName(project.director_nationalities, 'NO', 'Norway') },
    { id: 'language', label: 'Will the work be in Norwegian or another European language?', type: 'boolean', defaultValue: hasLanguage(project, 'english') },
    { id: 'genre_value', label: 'Will it contribute to the development of its genre?', type: 'boolean', defaultValue: false },
    { id: 'ambition', label: 'Is it an ambitious, demanding production of high quality and cultural value?', type: 'boolean', defaultValue: false },
    {
      id: 'role_count',
      label: 'How many of these roles are Norwegian, UK or EEA nationals: director, producer, DOP, assistant DOP, writer, lead actor, supporting actor, composer, sound designer, production designer, costume designer, editor, makeup artist, line producer, animation director, colourist, concept artist, lead VFX artist, post/VFX supervisor?',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'one_to_four', label: 'One to four' },
        { value: 'five_to_nine', label: 'Five to nine' },
        { value: 'ten_to_fourteen', label: 'Ten to fourteen' },
        { value: 'fifteen_plus', label: 'Fifteen or more' },
      ],
    },
    { id: 'crew_eea', label: 'Will at least 51% of the remaining crew be Norwegian, UK or EEA nationals?', type: 'boolean', defaultValue: false },
    {
      id: 'shooting',
      label: 'How much of the shooting happens on location or in studios in Norway?',
      type: 'select',
      defaultValue: hasShootInCountry(project, 'NO', 'Norway') ? 'some' : 'none',
      options: [
        { value: 'none', label: 'Very little or none' },
        { value: 'some', label: 'A meaningful amount' },
        { value: 'majority', label: 'Most of it' },
      ],
    },
    {
      id: 'services',
      label: 'How much of the production uses service providers from Norway, the UK or the EEA?',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'Very little or none' },
        { value: 'some', label: 'A meaningful amount' },
        { value: 'majority', label: 'Most of it' },
      ],
    },
    {
      id: 'post',
      label: 'How much of post-production happens in Norway, the UK or the EEA?',
      type: 'select',
      defaultValue: matchesCountryField(project.post_production_country, 'NO', 'Norway') ? 'majority' : 'none',
      options: [
        { value: 'none', label: 'Very little or none' },
        { value: 'some', label: 'A meaningful amount' },
        { value: 'majority', label: 'Most of it' },
      ],
    },
    { id: 'green', label: 'Do you have a strategy for sustainable and green production?', type: 'boolean', defaultValue: false },
  ]

  return {
    mode: 'scored',
    title: 'Norway qualification test self-check',
    intro: 'This follows Appendix 1 of the NFI incentive regulations.',
    thresholdText: 'Norway requires at least 4 points from Part I cultural criteria and at least 20 points overall out of 51.',
    passMark: 20,
    totalPoints: 51,
    passLabel: 'Pass',
    failLabel: 'Not enough points yet',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://cdn.craft.cloud/0df8a7fe-ef75-40cb-9e44-53aac4ffeac2/assets/uploads/documents/Maler-for-tilskuddsordningene/Regulations-on-financial-incentives-Norway-2023.pdf', 'Norwegian Film Institute incentive regulations', 'Appendix 1'),
    ],
    questions,
    evaluate: (answers) => {
      const sectionA = countYes(answers, ['culture_history', 'character', 'setting', 'adaptation', 'current_themes', 'values', 'writer_director', 'language']) * 2

      const sectionB =
        (answers.genre_value ? 3 : 0)
        + (answers.ambition ? 4 : 0)
        + ({ none: 0, one_to_four: 4, five_to_nine: 9, ten_to_fourteen: 14, fifteen_plus: 19 }[String(answers.role_count)] || 0)
        + (answers.crew_eea ? 4 : 0)
        + ({ none: 0, some: 2, majority: 4 }[String(answers.shooting)] || 0)
        + ({ none: 0, some: 2, majority: 4 }[String(answers.services)] || 0)
        + ({ none: 0, some: 3, majority: 6 }[String(answers.post)] || 0)
        + (answers.green ? 2 : 0)

      return {
        score: sectionA + sectionB,
        sections: [
          { label: 'Cultural criteria', score: sectionA, max: 16 },
          { label: 'Production criteria', score: sectionB, max: 35 },
        ],
      }
    },
  }
}

function buildAustraliaAssessment(project: ProjectInput): CulturalAssessment {
  const questions: CulturalQuestion[] = [
    { id: 'official_copro', label: 'Will the project qualify as an official Australian co-production?', type: 'boolean', defaultValue: hasCountryName(project.has_coproducer, 'AU', 'Australia') },
    { id: 'subject_matter', label: 'Is the film about Australia or Australians, or does it have a strong Australian creative connection?', type: 'boolean', defaultValue: matchesCountryField(project.subject_country, 'AU', 'Australia') || matchesCountryField(project.story_setting_country, 'AU', 'Australia') },
    { id: 'made_in_australia', label: 'Will most of the project be made in Australia across pre-production, production or post?', type: 'boolean', defaultValue: hasShootInCountry(project, 'AU', 'Australia') || matchesCountryField(project.post_production_country, 'AU', 'Australia') },
    { id: 'australian_creatives', label: 'Are the producer, writer, director and lead cast materially Australian?', type: 'boolean', defaultValue: hasCountryName(project.director_nationalities, 'AU', 'Australia') || hasCountryName(project.producer_nationalities, 'AU', 'Australia') },
    { id: 'australian_spend', label: 'Will a meaningful share of spend and services be incurred in Australia?', type: 'boolean', defaultValue: hasShootInCountry(project, 'AU', 'Australia') },
    { id: 'control', label: 'Do Australians keep meaningful creative control, copyright or recoupment participation?', type: 'boolean', defaultValue: hasCountryName(project.production_company_countries, 'AU', 'Australia') },
  ]

  return {
    mode: 'guided',
    title: 'Australia SAC / co-production check',
    intro: 'Producer Offset eligibility is either official co-production status or the Significant Australian Content test. Screen Australia treats SAC as a holistic test, so this checklist mirrors the published factors rather than inventing a fake points sheet.',
    thresholdText: 'Official co-productions qualify without the SAC test. Otherwise Screen Australia applies a holistic Significant Australian Content assessment.',
    passMark: 4,
    totalPoints: 5,
    passLabel: 'Likely strong enough',
    failLabel: 'Needs a stronger Australian case',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://www.screenaustralia.gov.au/getmedia/dca7da14-7350-4203-a332-c5115cfff996/Guidelines-producer-offset.pdf', 'Screen Australia Producer Offset Guidelines', 'Section 2.1 Significant Australian Content'),
    ],
    questions,
    evaluate: (answers) => {
      if (answers.official_copro) {
        return {
          score: 5,
          sections: [{ label: 'Qualification route', score: 5, max: 5 }],
        }
      }

      const score = countYes(answers, ['subject_matter', 'made_in_australia', 'australian_creatives', 'australian_spend', 'control'])
      return {
        score,
        sections: [{ label: 'SAC factors', score, max: 5 }],
      }
    },
  }
}

function buildAustriaAssessment(project: ProjectInput): CulturalAssessment {
  const questions: CulturalQuestion[] = [
    {
      id: 'setting',
      label: 'How is the story world set?',
      type: 'select',
      defaultValue: matchesCountryField(project.story_setting_country, 'AT', 'Austria') ? 'austria_eea' : 'other',
      options: [
        { value: 'austria_eea', label: 'Part of the scenes are set in Austria or another EEA country' },
        { value: 'fictitious', label: 'The scenes are mainly set in a fictitious non-real place' },
        { value: 'other', label: 'Neither of those' },
      ],
    },
    { id: 'recognisable_locations', label: 'Are recognisably Austrian or European locations used?', type: 'boolean', defaultValue: matchesCountryField(project.story_setting_country, 'AT', 'Austria') },
    { id: 'shooting_locations', label: 'Are Austrian or European locations used for the actual shoot?', type: 'boolean', defaultValue: hasShootInCountry(project, 'AT', 'Austria') },
    {
      id: 'protagonist',
      label: 'How does the main protagonist fit the test?',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'austria_eea', label: 'At least one main protagonist is Austrian or from another EEA state' },
        { value: 'neutral', label: 'The protagonist cannot be attributed to a specific nationality, culture or language' },
        { value: 'none', label: 'Neither' },
      ],
    },
    { id: 'plot_topic', label: 'Is the plot, underlying material or topic Austrian or European?', type: 'boolean', defaultValue: matchesCountryField(project.subject_country, 'AT', 'Austria') || matchesCountryField(project.story_setting_country, 'AT', 'Austria') },
    { id: 'existing_work', label: 'Is it based on an existing work such as literature, a play, an opera, a comic book or a game?', type: 'boolean', defaultValue: false },
    {
      id: 'arts_people',
      label: 'How many of these apply: the film deals with artists / an art form, a contemporary artist has a key role, it relates to a public figure, or it relates to a historic event?',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'one', label: 'One' },
        { value: 'two_plus', label: 'Two or more' },
      ],
    },
    { id: 'social_topics', label: 'Does it deal with current social, cultural, religious or philosophical topics?', type: 'boolean', defaultValue: false },
    { id: 'science_topics', label: 'Does it deal with scientific topics or natural phenomena?', type: 'boolean', defaultValue: false },
    {
      id: 'creative_roles',
      label: 'How many listed film-professional roles are filled by Austrians or other EEA nationals?',
      help: 'The annex scores producers, directors, writers, cinematographers, designers, editors, VFX / animation leads, composers, sound roles, performers and other Austrian film professions.',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'one_to_three', label: 'One to three' },
        { value: 'four_to_eight', label: 'Four to eight' },
        { value: 'nine_plus', label: 'Nine or more' },
      ],
    },
    {
      id: 'female_keys',
      label: 'How many of these key functions are held by women: scriptwriter, director, cinematographer, producer?',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'one', label: 'One' },
        { value: 'two', label: 'Two' },
        { value: 'three', label: 'Three' },
        { value: 'four', label: 'Four' },
      ],
    },
    {
      id: 'shoot_days',
      label: 'How many live-action shooting days will take place in Austria?',
      type: 'select',
      defaultValue: hasShootInCountry(project, 'AT', 'Austria') ? 'five_to_nine' : 'none',
      options: [
        { value: 'none', label: 'Under 5 days' },
        { value: 'five_to_nine', label: '5 to 9 days' },
        { value: 'ten_to_fourteen', label: '10 to 14 days' },
        { value: 'fifteen_plus', label: '15 or more days' },
      ],
    },
    {
      id: 'vfx_spend',
      label: 'How much VFX or animation spend will be placed in Austria?',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'under_50k', label: 'Up to EUR 50k' },
        { value: 'fifty_plus', label: 'EUR 50k or more' },
        { value: 'quarter_plus', label: 'EUR 250k or more for an all-VFX / animation project' },
        { value: 'million_plus', label: 'EUR 1m or more for an all-VFX / animation project' },
      ],
    },
    {
      id: 'music_recording',
      label: 'How much music recording will take place in Austria?',
      type: 'select',
      defaultValue: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'under_50k', label: 'Up to EUR 50k' },
        { value: 'fifty_plus', label: 'EUR 50k or more' },
      ],
    },
    { id: 'austrian_resources', label: 'Will you use Austrian film-specific resources such as camera, light, sound, props, SFX or post facilities?', type: 'boolean', defaultValue: hasShootInCountry(project, 'AT', 'Austria') || matchesCountryField(project.post_production_country, 'AT', 'Austria') },
    { id: 'green', label: 'Will the production meet the Austrian green-producing requirement?', type: 'boolean', defaultValue: false },
  ]

  return {
    mode: 'scored',
    title: 'Austria international cultural test',
    intro: 'This follows Annex 3 of the English FISA support guidelines for international productions.',
    thresholdText: 'Austria requires at least two Part A cultural-content criteria and at least 38/76 total points across Parts A to C.',
    passMark: 38,
    totalPoints: 76,
    passLabel: 'Pass',
    failLabel: 'Not enough points yet',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://www.aws.at/fileadmin/user_upload/Content.Node/media/richtlinien/ab_2020_01_FISA_RL_EN.pdf', 'Austria FISA support guidelines', 'Annex 3 cultural test for international productions'),
    ],
    questions,
    evaluate: (answers) => {
      const sectionA =
        ({ austria_eea: 4, fictitious: 2, other: 0 }[String(answers.setting)] || 0)
        + (answers.recognisable_locations ? 3 : 0)
        + (answers.shooting_locations ? 3 : 0)
        + ({ austria_eea: 3, neutral: 1, none: 0 }[String(answers.protagonist)] || 0)
        + (answers.plot_topic ? 3 : 0)
        + (answers.existing_work ? 2 : 0)
        + ({ none: 0, one: 2, two_plus: 6 }[String(answers.arts_people)] || 0)
        + (answers.social_topics ? 3 : 0)
        + (answers.science_topics ? 3 : 0)

      const sectionB =
        ({ none: 0, one_to_three: 6, four_to_eight: 16, nine_plus: 24 }[String(answers.creative_roles)] || 0)
        + ({ none: 0, one: 2, two: 4, three: 6, four: 8 }[String(answers.female_keys)] || 0)

      const sectionC =
        ({ none: 0, five_to_nine: 2, ten_to_fourteen: 3, fifteen_plus: 4 }[String(answers.shoot_days)] || 0)
        + ({ none: 0, under_50k: 1, fifty_plus: 2, quarter_plus: 3, million_plus: 6 }[String(answers.vfx_spend)] || 0)
        + ({ none: 0, under_50k: 1, fifty_plus: 2 }[String(answers.music_recording)] || 0)
        + (answers.austrian_resources ? 5 : 0)
        + (answers.green ? 1 : 0)

      return {
        score: sectionA + sectionB + sectionC,
        sections: [
          { label: 'Cultural content', score: sectionA, max: 30 },
          { label: 'Film professionals', score: sectionB, max: 32 },
          { label: 'Production', score: sectionC, max: 14 },
        ],
      }
    },
  }
}

function buildLithuaniaAssessment(project: ProjectInput): CulturalAssessment {
  const questions: CulturalQuestion[] = [
    { id: 'themes', label: 'Does the project reflect Lithuanian or wider European history, culture, traditions or current events?', type: 'boolean', defaultValue: matchesCountryField(project.subject_country, 'LT', 'Lithuania') || matchesCountryField(project.story_setting_country, 'LT', 'Lithuania') },
    { id: 'character', label: 'Is the main character living in Lithuania or Europe, or clearly linked to Lithuania or Europe?', type: 'boolean', defaultValue: matchesCountryField(project.subject_country, 'LT', 'Lithuania') || matchesCountryField(project.story_setting_country, 'LT', 'Lithuania') },
    { id: 'authors_and_crew', label: 'Will at least 51% of authors and at least 51% of the crew be Lithuanian or from another EU Member State?', type: 'boolean', defaultValue: false },
    { id: 'production_in_lithuania', label: 'Will production costs be incurred in Lithuania, including at least three filming days there?', type: 'boolean', defaultValue: hasShootInCountry(project, 'LT', 'Lithuania') },
  ]

  return {
    mode: 'scored',
    title: 'Lithuania cultural content test',
    intro: 'Lithuania publishes a four-part cultural-content test. Meeting any two of the four criteria is enough.',
    thresholdText: 'Lithuania requires at least 2 of the 4 published cultural-content criteria.',
    passMark: 2,
    totalPoints: 4,
    passLabel: 'Pass',
    failLabel: 'Not enough criteria yet',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://www.lkc.lt/en/tax-incentives/how-it-works/', 'Lithuanian Film Centre tax incentive', 'At least two of the four cultural-content criteria'),
    ],
    questions,
    evaluate: (answers) => {
      const score = countYes(answers, questions.map((question) => question.id))
      return {
        score,
        sections: [{ label: 'Cultural criteria', score, max: 4 }],
      }
    },
  }
}

function buildSlovakiaAssessment(project: ProjectInput): CulturalAssessment {
  const questions: CulturalQuestion[] = [
    { id: 'culture_story', label: 'Does the story or subject have a Slovak or broader European cultural connection?', type: 'boolean', defaultValue: matchesCountryField(project.subject_country, 'SK', 'Slovakia') || matchesCountryField(project.story_setting_country, 'SK', 'Slovakia') },
    { id: 'language_characters', label: 'Do the language, characters or world of the project support a Slovak or European claim?', type: 'boolean', defaultValue: hasLanguage(project, 'english') },
    { id: 'slovak_creatives', label: 'Will Slovak or other European creatives materially participate in key roles?', type: 'boolean', defaultValue: hasCountryName(project.director_nationalities, 'SK', 'Slovakia') || hasCountryName(project.producer_nationalities, 'SK', 'Slovakia') },
    { id: 'slovak_partner', label: 'Will there be a Slovak applicant, co-producer or service company on the project?', type: 'boolean', defaultValue: hasCountryName(project.has_coproducer, 'SK', 'Slovakia') || hasCountryName(project.production_company_countries, 'SK', 'Slovakia') },
    { id: 'slovak_activity', label: 'Will real filming, production, post or other execution happen in Slovakia?', type: 'boolean', defaultValue: hasShootInCountry(project, 'SK', 'Slovakia') || matchesCountryField(project.post_production_country, 'SK', 'Slovakia') },
    { id: 'slovak_resources', label: 'Will the project materially use Slovak crew, services or infrastructure?', type: 'boolean', defaultValue: (project.local_crew_percent || 0) >= 30 },
  ]

  return {
    mode: 'guided',
    title: 'Slovakia cultural test self-check',
    intro: 'The public Slovak cash-rebate material confirms the 24/48 threshold, but the detailed scoring matrix is embedded in the registration process. This questionnaire tracks the published cultural and production signals in a simpler producer-facing format.',
    thresholdText: 'The official Slovak cash-rebate materials state that the project must score at least 24/48 points in the cultural test.',
    passMark: 4,
    totalPoints: 6,
    passLabel: 'Likely viable',
    failLabel: 'Needs a stronger Slovak case',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://www.sfu.sk/en/cash-rebate', 'Slovak Audiovisual Fund cash rebate'),
      source('https://www.filmcommission.sk/data/att/2134.pdf', 'Slovak Film Commission cash rebate guide', '24/48 cultural-test threshold'),
    ],
    questions,
    evaluate: (answers) => {
      const cultural = countYes(answers, ['culture_story', 'language_characters', 'slovak_creatives'])
      const production = countYes(answers, ['slovak_partner', 'slovak_activity', 'slovak_resources'])
      return {
        score: cultural + production,
        sections: [
          { label: 'Cultural signals', score: cultural, max: 3 },
          { label: 'Production signals', score: production, max: 3 },
        ],
      }
    },
  }
}

function buildTurkeyAssessment(project: ProjectInput): CulturalAssessment {
  const questions: CulturalQuestion[] = [
    { id: 'content', label: 'Does the project have meaningful Turkish or wider cultural content in the story, subject or setting?', type: 'boolean', defaultValue: matchesCountryField(project.subject_country, 'TR', 'Turkey') || matchesCountryField(project.story_setting_country, 'TR', 'Turkey') },
    { id: 'turkish_creatives', label: 'Will Turkish citizens fill meaningful key creative roles?', type: 'boolean', defaultValue: hasCountryName(project.director_nationalities, 'TR', 'Turkey') || hasCountryName(project.producer_nationalities, 'TR', 'Turkey') },
    { id: 'turkish_crew', label: 'Will Turkish crew and performers materially participate?', type: 'boolean', defaultValue: (project.local_crew_percent || 0) >= 30 },
    { id: 'infrastructure', label: 'Will the project materially use Turkish film infrastructure and local services?', type: 'boolean', defaultValue: hasShootInCountry(project, 'TR', 'Turkey') || matchesCountryField(project.post_production_country, 'TR', 'Turkey') },
    { id: 'real_activity', label: 'Will real filming, post or VFX work happen in Turkey rather than only a paper spend claim?', type: 'boolean', defaultValue: hasShootInCountry(project, 'TR', 'Turkey') || matchesCountryField(project.post_production_country, 'TR', 'Turkey') },
  ]

  return {
    mode: 'guided',
    title: 'Turkey qualification test self-check',
    intro: 'The official Türkiye incentive guide describes a points-based qualification test built around cultural content, Turkish citizens and local infrastructure. This version turns those published buckets into a simple producer check.',
    thresholdText: 'The official Türkiye guide says the qualification test is points-based and requires 50/100 points.',
    passMark: 3,
    totalPoints: 5,
    passLabel: 'Likely viable',
    failLabel: 'Needs a stronger Turkish case',
    applyLabel: 'Apply This Result',
    sources: [
      source('https://www.filminginturkiye.com.tr/en/incentives/', 'Filming in Türkiye incentives page'),
      source('https://filminginturkiye.com.tr/fitcontents/uploaded/files/wft_incentives.pdf', 'Filming in Türkiye incentives guide', 'Qualification test'),
    ],
    questions,
    evaluate: (answers) => {
      const score = countYes(answers, questions.map((question) => question.id))
      return {
        score,
        sections: [{ label: 'Published criteria buckets', score, max: 5 }],
      }
    },
  }
}

function getCulturalAssessment(inc: EligibleIncentive, project: ProjectInput): CulturalAssessment {
  if (inc.country_code === 'GB') return buildUkCulturalAssessment(project)
  if (inc.country_code === 'IE') return buildIrelandAssessment(project)
  if (inc.country_code === 'HU') return buildHungaryAssessment(project)
  if (inc.country_code === 'PL') return buildPolandAssessment(project)
  if (inc.country_code === 'HR') return buildCroatiaAssessment(project)
  if (inc.country_code === 'IS') return buildIcelandAssessment(project)
  if (inc.country_code === 'NO') return buildNorwayAssessment(project)
  if (inc.country_code === 'AU') return buildAustraliaAssessment(project)
  if (inc.country_code === 'AT') return buildAustriaAssessment(project)
  if (inc.country_code === 'LT') return buildLithuaniaAssessment(project)
  if (inc.country_code === 'SK') return buildSlovakiaAssessment(project)
  if (inc.country_code === 'TR') return buildTurkeyAssessment(project)

  return buildGenericCulturalAssessment(inc, project)
}

function isBooleanQuestion(question: CulturalQuestion): question is CulturalQuestion & { type: 'boolean' } {
  return question.type === 'boolean'
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
  const [open, setOpen] = useState(false)

  const allIncentives = scenario.partners.flatMap((p) => p.eligible_incentives)
  const confirmedIncentives = allIncentives.filter((inc) => incentiveAmount(inc) > 0 && inc.counted_in_totals)
  const conditionalIncentives = allIncentives.filter((inc) => incentiveAmount(inc) > 0 && !inc.counted_in_totals)
  const strategicFunds = allIncentives.filter((inc) => incentiveAmount(inc) <= 0)
  const previewIncentives = [...confirmedIncentives, ...conditionalIncentives, ...strategicFunds]

  const confirmedTotal = scenario.estimated_total_financing_amount
  const conditionalTotal = scenario.estimated_conditional_financing_amount
  const nearMissTotal = scenario.near_misses?.reduce((sum, nm) => sum + (nm.potential_benefit_amount || 0), 0) || 0

  const thresholdRequirements = scenario.requirements.filter((r) => ['budget', 'spend', 'shoot', 'region'].includes(r.category))
  const adminRequirements = scenario.requirements.filter((r) => !['budget', 'spend', 'shoot', 'region', 'cultural'].includes(r.category))

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

      {previewIncentives.length > 0 && (
        <div className="border-t border-neutral-100 px-6 py-3">
          <div className="grid gap-2">
            {previewIncentives.map((inc, i) => (
              <div key={`${inc.name}-${i}`} className="flex items-center justify-between gap-4 border border-neutral-200 bg-white px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-neutral-900">
                    {inc.name} ({incentiveLocationLabel(inc)})
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {incentiveAmount(inc) > 0 && (
                    <span className="block text-sm font-bold text-neutral-900">
                      +{fmt(inc.benefit?.benefit_amount || 0, inc.benefit?.benefit_currency || currency)}
                    </span>
                  )}
                  <span className="block text-[10px] font-black uppercase tracking-widest text-neutral-400">
                    {incentiveHeadlineLabel(inc)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                    {inc.requirements.some((requirement) => requirement.category !== 'cultural') && (
                      <div className="border border-sky-200 bg-white p-4">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">What Still Needs To Be True</p>
                        <div className="mt-3">
                          <RequirementList requirements={inc.requirements.filter((requirement) => requirement.category !== 'cultural')} />
                        </div>
                      </div>
                    )}
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
                      onDocumentOpen={onDocumentOpen}
                    />
                    {inc.requirements.some((requirement) => requirement.category !== 'cultural') && (
                      <div className="mt-4">
                        <RequirementList requirements={inc.requirements.filter((requirement) => requirement.category !== 'cultural')} />
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
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-neutral-200">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-6 px-5 py-4 text-left"
      >
        <div className="min-w-0">
          <p className="font-bold text-base tracking-tight text-neutral-900">{inc.name} ({incentiveLocationLabel(inc)})</p>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-right">
          <div>
            {incentiveAmount(inc) > 0 && (
              <span className={`block text-lg font-bold ${amountColor}`}>+{fmt(inc.benefit?.benefit_amount || 0, inc.benefit?.benefit_currency || currency)}</span>
            )}
            <span className="block text-xs font-bold text-neutral-400 mt-1">
              {incentiveHeadlineLabel(inc)}
            </span>
          </div>
          {open ? <ChevronUp className="h-4 w-4 text-neutral-400" /> : <ChevronDown className="h-4 w-4 text-neutral-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-neutral-100 px-5 pb-5 pt-1">
          <p className="text-neutral-500 mt-3 max-w-xl">{inc.benefit?.benefit_explanation}</p>
          <CulturalTestControl
            inc={inc}
            project={project}
            onProjectUpdate={onProjectUpdate}
            onReanalyze={onReanalyze}
            onDocumentOpen={onDocumentOpen}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {inc.benefit?.sources.map((s, idx) => (
              <SourceBadge key={idx} source={s} onDocumentOpen={onDocumentOpen} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CulturalTestControl({
  inc,
  project,
  onProjectUpdate,
  onReanalyze,
  onDocumentOpen,
}: {
  inc: EligibleIncentive
  project: ProjectInput
  onProjectUpdate: (project: ProjectInput) => void
  onReanalyze: () => void
  onDocumentOpen?: DocOpenHandler
}) {
  const [showAssessment, setShowAssessment] = useState(false)
  const status = getCulturalStatus(project, inc.country_code)
  const needsCulturalTest = incentiveNeedsCulturalTest(inc)

  const assessment = useMemo(() => getCulturalAssessment(inc, project), [inc, project])
  const [answers, setAnswers] = useState<Record<string, CulturalAnswer>>(
    () => Object.fromEntries(assessment.questions.map((question) => [question.id, question.defaultValue])),
  )

  useEffect(() => {
    setAnswers(Object.fromEntries(assessment.questions.map((question) => [question.id, question.defaultValue])))
  }, [assessment])

  const thresholdText = assessment.thresholdText || requirementThresholdText(inc)
  const result = useMemo(() => assessment.evaluate(answers), [assessment, answers])
  const estimatedStatus: Exclude<CulturalStatus, 'unknown'> = result.score >= assessment.passMark ? 'pass' : 'fail'
  const estimatedLabel = estimatedStatus === 'pass' ? assessment.passLabel : assessment.failLabel

  if (!needsCulturalTest) return null

  const applyStatus = (nextStatus: Exclude<CulturalStatus, 'unknown'> | 'clear') => {
    onProjectUpdate(buildUpdatedProject(project, inc.country_code, nextStatus))
    setShowAssessment(false)
    onReanalyze()
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
            {status === 'unknown' && (
              assessment.mode === 'scored'
                ? 'This result depends on a cultural test check.'
                : 'This result depends on a structured qualification check.'
            )}
          </p>
          {thresholdText && (
            <p className="text-xs text-neutral-500 max-w-xl">{thresholdText}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowAssessment((current) => !current)}
            className="text-[10px] font-black tracking-widest px-4 py-1.5 bg-gallery-text text-white hover:bg-gallery-accent transition-all uppercase"
          >
            {showAssessment ? 'Hide Questions' : 'Check Now'}
          </button>

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

      {showAssessment && (
        <div className="border border-neutral-200 bg-white p-4 space-y-4">
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-wider text-neutral-500">
              {assessment.title}
            </p>
            <p className="text-sm text-neutral-600 max-w-2xl">
              {assessment.intro}
            </p>
            {assessment.sources && assessment.sources.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {assessment.sources.map((item, idx) => (
                  <SourceBadge key={`${item.url}-${idx}`} source={item} onDocumentOpen={onDocumentOpen} />
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4">
            {assessment.questions.map((question) => (
              <div key={question.id} className="border border-neutral-100 p-4 space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-neutral-800">{question.label}</p>
                  {question.help && <p className="text-xs text-neutral-500">{question.help}</p>}
                </div>

                {isBooleanQuestion(question) ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: true }))}
                      className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border transition-all ${
                        answers[question.id] === true
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: false }))}
                      className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border transition-all ${
                        answers[question.id] === false
                          ? 'border-neutral-900 bg-neutral-100 text-neutral-900'
                          : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'
                      }`}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <select
                    value={String(answers[question.id])}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))}
                    className="input bg-white"
                  >
                    {question.options?.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>

          <div className="grid gap-3 border-t border-neutral-100 pt-4 md:grid-cols-2 xl:grid-cols-4">
            {result.sections.map((section) => (
              <div key={section.label} className="border border-neutral-100 bg-neutral-50 px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">{section.label}</p>
                <p className="mt-1 text-lg font-bold text-neutral-900">{section.score} / {section.max}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-neutral-100 pt-4">
            <div className="space-y-1">
              <p className="text-xs text-neutral-500">
                Estimated score: <span className="font-bold text-neutral-800">{result.score} / {assessment.totalPoints}</span>
                {' '}<span className="text-neutral-400">
                  {assessment.mode === 'scored'
                    ? `Need ${assessment.passMark} to pass.`
                    : `Usually you want at least ${assessment.passMark} strong signals here.`}
                </span>
              </p>
              <p className={`text-[10px] font-black uppercase tracking-widest ${
                estimatedStatus === 'pass' ? 'text-emerald-700' : 'text-amber-700'
              }`}>
                {assessment.mode === 'scored' ? 'Estimated result' : 'Producer estimate'}: {estimatedLabel}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => applyStatus(estimatedStatus)}
                className="text-[10px] font-black tracking-widest px-4 py-1.5 bg-gallery-text text-white hover:bg-gallery-accent transition-all uppercase"
              >
                {assessment.applyLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
