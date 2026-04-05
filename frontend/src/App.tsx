import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from './config'
import type { ProjectInput, AnalyzeResponse } from './types'
import { ProjectForm } from './components/ProjectForm'
import { ScenarioList } from './components/ScenarioList'
import { DocumentPanel } from './components/DocumentPanel'
import { Info, ArrowRight, Clock3 } from 'lucide-react'

const EXPECTED_WAKE_UP_SECONDS = 30
const WAKE_UP_POLL_INTERVAL_MS = 4000

const DEFAULT_PROJECT: ProjectInput = {
  title: '',
  format: 'feature_fiction',
  stage: 'production',
  budget: 0,
  budget_currency: 'EUR',
  budget_min: undefined,
  budget_max: undefined,
  shoot_locations_flexible: false,
  open_to_copro_countries: [],
  director_nationalities: [],
  producer_nationalities: [],
  production_company_countries: [],
  languages: [],
  development_fraction: 0.05,
  above_the_line_fraction: 0.20,
  production_btl_fraction: 0.40,
  post_production_btl_fraction: 0.25,
  other_fraction: 0.10,
  post_production_country: undefined,
  shoot_locations: [{ country: '', region: undefined, percent: 0 }],
  spend_allocations: [],
  stages: [],
  post_flexible: false,
  vfx_flexible: false,
  has_coproducer: [],
  willing_add_coproducer: true,
  streamer_attached: false,
  cultural_test_passed: [],
  cultural_test_failed: [],
}

function App() {
  const [project, setProject] = useState<ProjectInput>(DEFAULT_PROJECT)
  const [response, setResponse] = useState<AnalyzeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ countries: 0, incentives: 0, treaties: 0 })
  const [docViewer, setDocViewer] = useState<{ documentId: number; annotationId?: number | null } | null>(null) 
  const [backendReady, setBackendReady] = useState(false)
  const [warmupStartedAt] = useState(() => Date.now())
  const [elapsedWarmupSeconds, setElapsedWarmupSeconds] = useState(0)

  const handleDocumentOpen = useCallback((documentId: number, annotationId?: number | null) => {
    setDocViewer({ documentId, annotationId })
  }, [])

  useEffect(() => {
    if (backendReady) return

    const timer = window.setInterval(() => {
      setElapsedWarmupSeconds(Math.floor((Date.now() - warmupStartedAt) / 1000))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [backendReady, warmupStartedAt])

  useEffect(() => {
    let cancelled = false
    let retryTimer: number | undefined

    const loadStats = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/stats`, { cache: 'no-store' })
        if (!response.ok) throw new Error('Stats unavailable')
        const data = await response.json()
        if (!cancelled) {
          setStats(data)
        }
      } catch {
        // Keep the existing placeholder counts if the backend is still waking up.
      }
    }

    const checkBackend = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/health/db`, { cache: 'no-store' })
        if (!response.ok) throw new Error('Backend unavailable')
        const data = await response.json()
        if (cancelled) return

        if (data.ready) {
          setBackendReady(true)
          loadStats()
          return
        }
      } catch {
        if (cancelled) return
      }

      retryTimer = window.setTimeout(checkBackend, WAKE_UP_POLL_INTERVAL_MS)
    }

    checkBackend()

    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [])

  useEffect(() => {
    if (backendReady) {
      setError((currentError) =>
        currentError === 'The demo is still waking up. Give it a few seconds and the form will unlock automatically.'
          ? null
          : currentError
      )
    }
  }, [backendReady])

  const analyze = async () => {
    if (!backendReady) {
      setError('The demo is still waking up. Give it a few seconds and the form will unlock automatically.')
      return
    }
    if (!project.budget || project.budget <= 0) {
      setError('Please enter a budget to begin.')
      return
    }
    setLoading(true)
    setError(null)
    setResponse(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      })
      if (!res.ok) throw new Error(await res.text())
      const data: AnalyzeResponse = await res.json()
      setResponse(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  const scenarioCount = response?.scenarios.length ?? 0
  const remainingWarmupSeconds = Math.max(EXPECTED_WAKE_UP_SECONDS - elapsedWarmupSeconds, 0)

  return (
    <div className="min-h-screen bg-gallery-base text-gallery-text selection:bg-gallery-accent selection:text-white">
      {/* High-End Header */}
      <header className="border-b border-neutral-100 bg-white sticky top-0 z-50">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-12">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-gallery-text flex items-center justify-center rounded-sm">
                <span className="text-white font-serif font-bold text-lg">C</span>
              </div>
              <h1 className="text-xl font-bold tracking-tight font-serif">CoPro Calculator</h1>
            </div>
          </div>

          {backendReady ? (
            <div className="hidden lg:flex items-center gap-4 text-[10px] font-bold text-neutral-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              LIVE DATA &middot; {stats.countries} REGIONS &middot; {stats.treaties} TREATIES
            </div>
          ) : (
            <div className="hidden lg:flex items-center gap-4 text-[10px] font-bold text-amber-600">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              STARTING DEMO &middot; PLEASE WAIT ~30 SECONDS
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-12">
        {/* Simple Introduction */}
        <section className="mb-12 pb-8 border-b border-neutral-100">
          <p className="text-lg text-neutral-600 leading-relaxed max-w-5xl">
            Input your project details to find the international film funds and tax credits you qualify for today.
            The calculator also identifies additional financing you could unlock through minor logistical changes or by adding a co-production partner.
            Every scenario is transparent: click any result to inspect the underlying math and cited treaty texts.
            Use the project form to input your data directly and compare financing scenarios.
          </p>
        </section>

        <div className="grid gap-16 lg:grid-cols-12">
          {/* Left: Project Definition */}
          <section className="lg:col-span-5 xl:col-span-4">
            <div className="lg:sticky lg:top-32 space-y-8">
              <div>
                <h2 className="text-2xl font-bold font-serif tracking-tight">Project details</h2>
                <p className="mt-2 text-sm text-neutral-500">Provide your film's basics to see available financing.</p>
              </div>

              <div className="relative">
                <div className={`card p-6 transition-opacity duration-300 ${backendReady ? 'opacity-100' : 'opacity-50'}`}>
                  <ProjectForm
                    project={project}
                    onChange={setProject}
                    onAnalyze={analyze}
                    loading={loading}
                    error={error}
                    backendReady={backendReady}
                  />
                </div>
                {!backendReady && (
                  <div className="absolute inset-0 z-10 rounded-sm border border-amber-200 bg-white/70 backdrop-blur-[2px]" />
                )}
              </div>
            </div>
          </section>

          {/* Right: Results */}
          <section className="lg:col-span-7 xl:col-span-8">
            {!response && !loading && (
              backendReady ? (
                <div className="h-full flex flex-col items-center justify-center py-32 text-center border-2 border-dashed border-neutral-100 rounded-sm">
                  <div className="p-4 bg-neutral-50 rounded-full mb-6">
                    <ArrowRight className="h-8 w-8 text-neutral-300" />
                  </div>
                  <h3 className="text-xl font-bold font-serif text-neutral-400">Ready to analyze</h3>
                  <p className="mt-2 text-sm text-neutral-400 max-w-xs mx-auto">
                    Fill in the project profile on the left to see potential savings and treaty options.
                  </p>
                </div>
              ) : (
                <div className="rounded-sm border border-neutral-200 bg-white p-8 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)]">
                  <div className="max-w-2xl space-y-5">
                    <div className="inline-flex items-center gap-3 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold uppercase tracking-[0.22em] text-amber-700">
                      <Clock3 className="h-4 w-4" />
                      Please wait about {remainingWarmupSeconds > 0 ? remainingWarmupSeconds : 10} seconds while the demo starts up.
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-3xl font-bold font-serif tracking-tight text-gallery-text">Co-production calculator</h3>
                      <p className="max-w-xl text-sm leading-relaxed text-neutral-600">
                        Compare film financing scenarios, treaty routes, and incentive options. The form will unlock automatically when the demo is ready.
                      </p>
                    </div>
                  </div>
                </div>
              )
            )}

            {loading && (
              <div className="py-32 text-center space-y-6">
                <div className="inline-block h-10 w-10 border-2 border-gallery-accent border-t-transparent animate-spin rounded-full" />
                <p className="text-[11px] font-bold tracking-[0.3em] text-neutral-400 uppercase">Calculating Scenarios...</p>
              </div>
            )}

            {response && (
              <div className="space-y-12 animate-in fade-in duration-700">
                <header className="space-y-4">
                  <div className="flex items-end justify-between border-b border-gallery-text pb-6">
                    <h2 className="text-3xl font-bold font-serif tracking-tight">Financing Scenarios</h2>       
                    <div className="text-[11px] font-black uppercase tracking-widest text-gallery-accent bg-gallery-accent/5 px-3 py-1 border border-gallery-accent/20">
                      {scenarioCount} OPTIONS FOUND
                    </div>
                  </div>
                  <p className="text-sm text-neutral-500 italic leading-relaxed">"{response.project_summary}"</p>
                </header>

                <ScenarioList
                  scenarios={response.scenarios}
                  project={project}
                  budget={project.budget}
                  currency={project.budget_currency}
                  onProjectUpdate={setProject}
                  onReanalyze={analyze}
                  onDocumentOpen={handleDocumentOpen}
                />

                <footer className="mt-24 pt-8 border-t border-neutral-100 flex items-start gap-4">
                  <Info className="h-4 w-4 text-neutral-300 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-neutral-400 leading-relaxed uppercase tracking-wider">
                    Disclaimer: {response.data_disclaimer}
                  </p>
                </footer>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Document Slide-over */}
      {docViewer && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]"
            onClick={() => setDocViewer(null)}
          />
          <DocumentPanel
            documentId={docViewer.documentId}
            annotationId={docViewer.annotationId}
            onClose={() => setDocViewer(null)}
          />
        </>
      )}
    </div>
  )
}

export default App
