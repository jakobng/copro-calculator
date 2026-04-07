import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../config'
import type { ProjectInput, ShootLocation, CountryOption } from '../types'
import { Plus, X, ChevronDown } from 'lucide-react'

const FORMATS = [
  { value: 'feature_fiction', label: 'Feature Fiction' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'series', label: 'Series' },
  { value: 'animation', label: 'Animation' },
]

const STAGES = [
  { value: 'development', label: 'Development' },
  { value: 'production', label: 'Production' },
  { value: 'post', label: 'Post-Production' },
]

const COMMON_BUDGET_CURRENCIES = ['EUR', 'USD', 'GBP'] as const

const ALL_BUDGET_CURRENCIES = [
  { value: 'EUR', label: 'Euro' },
  { value: 'USD', label: 'US Dollar' },
  { value: 'GBP', label: 'British Pound' },
  { value: 'AUD', label: 'Australian Dollar' },
  { value: 'CAD', label: 'Canadian Dollar' },
  { value: 'CHF', label: 'Swiss Franc' },
  { value: 'JPY', label: 'Japanese Yen' },
  { value: 'CNY', label: 'Chinese Yuan' },
  { value: 'INR', label: 'Indian Rupee' },
  { value: 'BRL', label: 'Brazilian Real' },
  { value: 'MXN', label: 'Mexican Peso' },
  { value: 'ZAR', label: 'South African Rand' },
  { value: 'KRW', label: 'South Korean Won' },
  { value: 'SGD', label: 'Singapore Dollar' },
  { value: 'NZD', label: 'New Zealand Dollar' },
] as const

const SUGGESTED_CURRENCY_BY_COUNTRY: Record<string, string> = {
  AU: 'AUD',
  CA: 'CAD',
  CH: 'CHF',
  CN: 'CNY',
  GB: 'GBP',
  IN: 'INR',
  JP: 'JPY',
  KR: 'KRW',
  MX: 'MXN',
  NZ: 'NZD',
  SG: 'SGD',
  US: 'USD',
  ZA: 'ZAR',
}

interface Props {
  project: ProjectInput
  onChange: (project: ProjectInput) => void
  onAnalyze: () => void
  loading: boolean
  error: string | null
  backendReady: boolean
}

export function ProjectForm({ project, onChange, onAnalyze, loading, error, backendReady }: Props) {
  const [countries, setCountries] = useState<CountryOption[]>([])
  const [regionsByCountryCode, setRegionsByCountryCode] = useState<Record<string, string[]>>({})
  const [showMoreCurrencies, setShowMoreCurrencies] = useState(false)
  const [currencyTouched, setCurrencyTouched] = useState(false)
  const [lastAutoCurrency, setLastAutoCurrency] = useState<string | null>(null)

  useEffect(() => {
    if (!backendReady) return

    fetch(`${API_BASE_URL}/api/countries`)
      .then((r) => r.json())
      .then(setCountries)
      .catch(() => {})
  }, [backendReady])

  useEffect(() => {
    if (!backendReady || countries.length === 0) return

    const selectedCountryCodes = Array.from(new Set(
      project.shoot_locations
        .map((loc) => countries.find((country) => country.name.toLowerCase() === loc.country.toLowerCase())?.code)
        .filter((code): code is string => Boolean(code))
    ))

    selectedCountryCodes.forEach((countryCode) => {
      if (countryCode in regionsByCountryCode) return

      fetch(`${API_BASE_URL}/api/regions/${countryCode}`)
        .then((r) => r.json())
        .then((data) => {
          setRegionsByCountryCode((current) => {
            if (countryCode in current) return current
            return { ...current, [countryCode]: data.regions || [] }
          })
        })
        .catch(() => {
          setRegionsByCountryCode((current) => {
            if (countryCode in current) return current
            return { ...current, [countryCode]: [] }
          })
        })
    })
  }, [backendReady, countries, project.shoot_locations, regionsByCountryCode])

  const getCountryCode = (countryName: string) =>
    countries.find((country) => country.name.toLowerCase() === countryName.toLowerCase())?.code

  const getCountryName = (countryCode: string) =>
    countries.find((country) => country.code === countryCode)?.name || countryCode

  const currencyContextCountryCode =
    project.shoot_locations
      .map((loc) => getCountryCode(loc.country))
      .find((code): code is string => Boolean(code))
    || project.production_company_countries
      .map((countryName) => getCountryCode(countryName))
      .find((code): code is string => Boolean(code))
    || project.producer_nationalities
      .map((countryName) => getCountryCode(countryName))
      .find((code): code is string => Boolean(code))

  const suggestedCurrency = currencyContextCountryCode
    ? SUGGESTED_CURRENCY_BY_COUNTRY[currencyContextCountryCode]
    : undefined

  useEffect(() => {
    if (!suggestedCurrency || currencyTouched) return
    if (suggestedCurrency === project.budget_currency) return
    if (project.budget_currency !== 'EUR' && project.budget_currency !== lastAutoCurrency) return

    onChange({ ...project, budget_currency: suggestedCurrency })
    setLastAutoCurrency(suggestedCurrency)
  }, [currencyTouched, lastAutoCurrency, onChange, project, suggestedCurrency])

  const update = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => {
    onChange({ ...project, [key]: value })
  }

  const setBudgetCurrency = (currency: string) => {
    setCurrencyTouched(true)
    update('budget_currency', currency)
  }

  const addShootLocation = () => {
    onChange({
      ...project,
      shoot_locations: [...project.shoot_locations, { country: '', region: undefined, percent: 0 }],
    })
  }

  const updateShootLocation = (index: number, loc: Partial<ShootLocation>) => {
    onChange({
      ...project,
      shoot_locations: project.shoot_locations.map((l, i) =>
        i === index ? { ...l, ...loc } : l
      ),
    })
  }

  const removeShootLocation = (index: number) => {
    onChange({
      ...project,
      shoot_locations: project.shoot_locations.filter((_, i) => i !== index),
    })
  }

  const totalShootPct = project.shoot_locations.reduce((sum, l) => sum + l.percent, 0)

  const getRegionOptions = (countryName: string) => {
    const countryCode = getCountryCode(countryName)
    if (!countryCode) return []
    return regionsByCountryCode[countryCode] || []
  }

  return (
    <div className="space-y-10">
      {/* Essentials */}
      <section className="space-y-5">
        <Field label="Title">
          <input
            type="text"
            value={project.title}
            onChange={(e) => update('title', e.target.value)}
            placeholder="Working project name"
            className="input"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Format">
            <select value={project.format} onChange={(e) => update('format', e.target.value)} className="input bg-white">
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Stage">
            <select value={project.stage} onChange={(e) => update('stage', e.target.value)} className="input bg-white">
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
        </div>
      </section>
{/* Finance */}
<section className="space-y-5">
  <Field label="Total Budget">
    <div className="space-y-3">
      <div className="flex gap-2">
      <div className="relative flex-1">
        <input
          type="number"
          min={1}
          value={project.budget || ''}
          onChange={(e) => update('budget', Math.max(0, parseFloat(e.target.value) || 0))}
          placeholder="0.00"
          className="input font-bold"
        />
      </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {COMMON_BUDGET_CURRENCIES.map((currency) => (
          <button
            key={currency}
            type="button"
            onClick={() => setBudgetCurrency(currency)}
            className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest border transition-all ${
              project.budget_currency === currency
                ? 'border-gallery-text bg-gallery-text text-white'
                : 'border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'
            }`}
          >
            {currency}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowMoreCurrencies((current) => !current)}
          className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest border transition-all ${
            !COMMON_BUDGET_CURRENCIES.includes(project.budget_currency as typeof COMMON_BUDGET_CURRENCIES[number]) || showMoreCurrencies
              ? 'border-neutral-900 bg-neutral-100 text-neutral-900'
              : 'border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'
          }`}
        >
          {COMMON_BUDGET_CURRENCIES.includes(project.budget_currency as typeof COMMON_BUDGET_CURRENCIES[number]) ? 'More' : project.budget_currency}
        </button>
      </div>
      {showMoreCurrencies && (
        <select
          value={project.budget_currency}
          onChange={(e) => setBudgetCurrency(e.target.value)}
          className="input bg-white font-bold"
        >
          {ALL_BUDGET_CURRENCIES.map((currency) => (
            <option key={currency.value} value={currency.value}>{currency.value} · {currency.label}</option>
          ))}
        </select>
      )}
      {suggestedCurrency && currencyContextCountryCode && (
        <p className="text-[10px] font-medium text-neutral-400">
          Suggested from {getCountryName(currencyContextCountryCode)}: {suggestedCurrency}
        </p>
      )}
    </div>
  </Field>

  <BudgetBreakdown project={project} onChange={onChange} />
</section>

{/* Production */}
<section className="space-y-5">
        <div className="flex items-end justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Shooting Locations</span>
          <span className={`text-[10px] font-bold ${Math.abs(totalShootPct - 100) <= 1 ? 'text-emerald-600' : 'text-gallery-accent'}`}>
            {totalShootPct}% ALLOCATED
          </span>
        </div>

        <div className="space-y-3">
          {project.shoot_locations.map((loc, i) => (
            <div key={i} className="flex items-start gap-2 group">
              <div className="flex-1 space-y-2">
                <CountryInput
                  value={loc.country}
                  onChange={(v) => updateShootLocation(i, { country: v, region: undefined })}
                  countries={countries}
                  placeholder="Country"
                />
                {loc.country && getRegionOptions(loc.country).length > 0 && (
                  <div className="space-y-1">
                    <select
                      value={loc.region || ''}
                      onChange={(e) => updateShootLocation(i, { region: e.target.value || undefined })}
                      className="input bg-white text-xs"
                    >
                      <option value="">No specific region</option>
                      {getRegionOptions(loc.country).map((region) => (
                        <option key={region} value={region}>{region}</option>
                      ))}
                    </select>
                    <p className="text-[10px] font-medium text-neutral-400">Select a region only if you plan to shoot there.</p>
                  </div>
                )}
              </div>
              <div className="relative w-20">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={loc.percent || ''}
                  onChange={(e) => updateShootLocation(i, { percent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                  className="input pr-6 text-right"
                />
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] font-bold text-neutral-300">%</span>
              </div>
              <button
                type="button"
                onClick={() => removeShootLocation(i)}
                className="p-2 text-neutral-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addShootLocation}
            className="w-full py-2 border border-dashed border-neutral-200 text-[10px] font-bold tracking-widest text-neutral-400 hover:border-gallery-accent hover:text-gallery-accent transition-all flex items-center justify-center gap-2"
          >
            <Plus className="h-3.5 w-3.5" />
            ADD LOCATION
          </button>
        </div>
      </section>

      {/* Registry */}
      <section className="space-y-5">
        <Field label="Director Nationality">
          <MultiCountryInput
            values={project.director_nationalities}
            onCommit={(v) => update('director_nationalities', v)}
            countries={countries}
            placeholder="Add region"
          />
        </Field>
        <Field label="Producer Nationality">
          <MultiCountryInput
            values={project.producer_nationalities}
            onCommit={(v) => update('producer_nationalities', v)}
            countries={countries}
            placeholder="Add region"
          />
        </Field>
        <Field label="Production Company Location">
          <MultiCountryInput
            values={project.production_company_countries}
            onCommit={(v) => update('production_company_countries', v)}
            countries={countries}
            placeholder="Add region"
          />
        </Field>
      </section>

      {/* Logic */}
      <section className="space-y-4 pt-4 border-t border-neutral-100">
        <Toggle
          checked={project.shoot_locations_flexible}
          onChange={(v) => update('shoot_locations_flexible', v)}
          label="Flexible shooting"
        />
        <Toggle
          checked={project.post_flexible}
          onChange={(v) => update('post_flexible', v)}
          label="Flexible post-production"
        />
      </section>

      {/* CTA */}
      <div className="pt-4">
        <button
          type="button"
          onClick={onAnalyze}
          disabled={loading || !project.budget || !backendReady}
          className="btn-primary"
        >
          {loading ? 'PROCESSING...' : backendReady ? 'FIND CO-PRODUCTION OPTIONS' : 'WAKING UP DEMO...'}
        </button>

        {error && (
          <p className="mt-4 text-xs font-bold text-red-500 text-center uppercase tracking-widest">{error}</p>  
        )}
      </div>
    </div>
  )
}

function BudgetBreakdown({ project, onChange }: {
  project: ProjectInput
  onChange: (project: ProjectInput) => void
}) {
  const [open, setOpen] = useState(false)

  const updateFrac = (key: keyof ProjectInput, val: number) => {
    onChange({ ...project, [key]: val / 100 })
  }

  const sections = [
    { label: 'Development', key: 'development_fraction' },
    { label: 'Above-the-Line', key: 'above_the_line_fraction' },
    { label: 'Production (BTL)', key: 'production_btl_fraction' },
    { label: 'Post-Production (BTL)', key: 'post_production_btl_fraction' },
    { label: 'Other (Legal/Cont.)', key: 'other_fraction' },
  ] as const

  const total = sections.reduce((sum, s) => sum + Math.round((project[s.key] as number) * 100), 0)

  return (
    <div className="space-y-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[10px] font-bold text-neutral-400 uppercase tracking-widest hover:text-gallery-accent transition-colors"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        Detailed Budget Allocation
      </button>

      {open && (
        <div className="space-y-5 p-4 bg-neutral-50 rounded-sm border border-neutral-100 animate-in slide-in-from-top-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {sections.map((s) => (
              <Field key={s.key} label={`${s.label} %`}>
                <input
                  type="number" min={0} max={100}
                  value={Math.round((project[s.key] as number) * 100)}
                  onChange={(e) => updateFrac(s.key, parseFloat(e.target.value) || 0)}
                  className="input bg-white"
                />
              </Field>
            ))}
          </div>
          <div className="pt-2 flex justify-between items-center border-t border-neutral-200">
            <span className="text-[10px] font-bold text-neutral-400 uppercase">Total Allocation</span>
            <span className={`text-xs font-black ${total === 100 ? 'text-emerald-600' : 'text-red-500'}`}>{total}%</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400">{label}</label>      
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, label }: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-left group"
    >
      <div className={`h-4 w-4 rounded-sm border-2 transition-all flex items-center justify-center ${
        checked ? 'bg-gallery-accent border-gallery-accent' : 'bg-white border-neutral-200 group-hover:border-neutral-300'
      }`}>
        {checked && <div className="h-1.5 w-1.5 bg-white rounded-full" />}
      </div>
      <span className={`text-xs font-bold uppercase tracking-wide transition-colors ${checked ? 'text-gallery-text' : 'text-neutral-400 hover:text-neutral-600'}`}>{label}</span>
    </button>
  )
}

function CountryInput({
  value,
  onChange,
  onSelect,
  countries,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onSelect?: (v: string) => void
  countries: CountryOption[]
  placeholder?: string
}) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [focused, setFocused] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const query = value.trim().toLowerCase()
  const suggestions = query.length >= 1
    ? countries.filter((c) =>
        c.name.toLowerCase().includes(query) || c.code.toLowerCase() === query
      )
    : []

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => {
        const nextIndex = (i + 1) % suggestions.length
        document.getElementById(`suggestion-${nextIndex}`)?.scrollIntoView({ block: 'nearest' })
        return nextIndex
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => {
        const nextIndex = (i - 1 + suggestions.length) % suggestions.length
        document.getElementById(`suggestion-${nextIndex}`)?.scrollIntoView({ block: 'nearest' })
        return nextIndex
      })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      selectOption(suggestions[selectedIndex])
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  const selectOption = (c: CountryOption) => {
    onChange(c.name)
    onSelect?.(c.name)
    setShowSuggestions(false)
  }

  const validateAndBlur = () => {
    setFocused(false)
    setTimeout(() => {
      setShowSuggestions(false)
      // Strict matching: if the typed value isn't an exact country name, clear it
      const exactMatch = countries.find(c => c.name.toLowerCase() === value.toLowerCase())
      if (!exactMatch && value !== '') {
        onChange('')
      }
    }, 200)
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setShowSuggestions(true)
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => { setFocused(true); setShowSuggestions(true) }}
        onBlur={validateAndBlur}
        placeholder={placeholder}
        className="input uppercase font-bold"
        autoComplete="off"
      />
      {showSuggestions && focused && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 bg-white border border-neutral-100 shadow-xl rounded-sm py-1 max-h-60 overflow-y-auto">
          {suggestions.map((c, i) => (
            <li key={c.code} id={`suggestion-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectOption(c)}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-xs transition-colors ${
                  i === selectedIndex ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                }`}
              >
                <span className="font-bold uppercase">{c.name}</span>
                <span className="text-[10px] font-bold text-neutral-300">{c.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MultiCountryInput({
  values,
  onCommit,
  countries,
  placeholder,
}: {
  values: string[]
  onCommit: (v: string[]) => void
  countries: CountryOption[]
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  const handleSelect = (name: string) => {
    onCommit(Array.from(new Set([...values, name])))
    setDraft('')
  }

  const removeCountry = (index: number) => {
    onCommit(values.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="flex items-center gap-1.5 bg-neutral-100 px-2 py-1 rounded-sm text-[10px] font-black uppercase"
          >
            {v}
            <button onClick={() => removeCountry(i)} className="text-neutral-400 hover:text-red-500"><X className="h-3 w-3" /></button>
          </span>
        ))}
      </div>
      <CountryInput
        value={draft}
        onChange={setDraft}
        onSelect={handleSelect}
        countries={countries}
        placeholder={values.length === 0 ? placeholder : ""}
      />
    </div>
  )
}
