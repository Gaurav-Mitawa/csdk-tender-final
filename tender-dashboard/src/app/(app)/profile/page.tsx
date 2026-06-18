'use client'

import { useEffect, useState } from 'react'
import { LoaderCircle, Save, Sparkles, Plus, Trash2 } from 'lucide-react'

type Form = Record<string, string>
type PItem = {
  project_name: string
  description: string
  approx_value_cr: string
  categories: string
  completion_certificate: string
}

const THRESH_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'min_tender_value_cr', label: 'Min tender value (₹ Cr)', hint: 'Below this → not stored (rejected)' },
  { key: 'max_tender_value_cr', label: 'Max tender value (₹ Cr)', hint: 'Blank = no cap' },
]
// each gets its own ± margin % + live calculator (capacity gate ones drive PARTIAL)
const MARGIN_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'turnover_3yr_avg_cr', label: 'Turnover — 3yr avg (₹ Cr)', hint: 'Capacity gate → within +margin = PARTIAL' },
  { key: 'turnover_last_year_cr', label: 'Turnover — last year (₹ Cr)' },
  { key: 'net_worth_latest_cr', label: 'Net worth — latest (₹ Cr)', hint: 'Capacity gate → within +margin = PARTIAL' },
  { key: 'net_worth_3yr_avg_cr', label: 'Net worth — 3yr avg (₹ Cr)' },
  { key: 'bank_solvency_cr', label: 'Bank solvency certificate (₹ Cr)' },
  { key: 'emd_threshold_cr', label: 'EMD threshold (₹ Cr)' },
  { key: 'pbg_threshold_pct', label: 'PBG threshold (%)' },
]
const SCORE_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'eligible_min_score', label: 'ELIGIBLE min score', hint: 'Eligible ≥ this (shown as 100)' },
  { key: 'partial_min_score', label: 'PARTIAL min score' },
]
const NUM_KEYS = [...THRESH_FIELDS, ...MARGIN_FIELDS, ...SCORE_FIELDS].map((x) => x.key)
const INPUT = 'h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-amber-400/60'
const AREA = 'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-amber-400/60'

function normalize(j: Record<string, unknown>): Form {
  const f: Form = {}
  for (const [k, v] of Object.entries(j)) {
    if (Array.isArray(v)) f[k] = v.join(', ')
    else if (v && typeof v === 'object') f[k] = JSON.stringify(v, null, 2)
    else f[k] = v === null || v === undefined ? '' : String(v)
  }
  return f
}
const num = (v: string) => (v.trim() === '' ? null : Number(v))
const arr = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean)
const EMPTY_ROW: PItem = { project_name: '', description: '', approx_value_cr: '', categories: '', completion_certificate: '' }

// Module-level so React keeps the inputs mounted (no focus loss on keystroke).
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}
function Field({
  value, onChange, label, hint, type = 'text',
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  label: string
  hint?: string
  type?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-foreground">{label}</span>
      <input type={type} step="any" value={value} onChange={onChange} className={INPUT} />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

function marginsFromObj(o: unknown): Record<string, string> {
  const m: Record<string, string> = {}
  if (o && typeof o === 'object')
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) m[k] = v == null ? '' : String(v)
  return m
}

// value + its own ± margin % + a live calculator of the ₹ swing.
function FinField({
  label, hint, value, margin, onValue, onMargin,
}: {
  label: string
  hint?: string
  value: string
  margin: string
  onValue: (e: React.ChangeEvent<HTMLInputElement>) => void
  onMargin: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const v = parseFloat(value)
  const m = parseFloat(margin || '5')
  const ok = !Number.isNaN(v) && v > 0 && !Number.isNaN(m)
  const d = ok ? (v * m) / 100 : 0
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[150px] flex-1 flex-col gap-1">
          <span className="text-sm text-foreground">{label}</span>
          <input type="number" step="any" value={value} onChange={onValue} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">± margin %</span>
          <input type="number" step="any" value={margin} onChange={onMargin} placeholder="5" className={`${INPUT} w-20`} />
        </label>
      </div>
      {ok && (
        <p className="mt-2 text-[11px] text-amber-700">
          ±{m}% = ±{d.toFixed(2)} → {(v - d).toFixed(2)} – {(v + d).toFixed(2)} Cr
        </p>
      )}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export default function ProfilePage() {
  const [f, setF] = useState<Form>({})
  const [margins, setMargins] = useState<Record<string, string>>({})
  const [portfolio, setPortfolio] = useState<PItem[]>([])
  const [legalItems, setLegalItems] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [genning, setGenning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/profile')
        if (r.status === 401) {
          window.location.href = '/login'
          return
        }
        const j = (await r.json().catch(() => ({}))) || {}
        setF(normalize(j))
        setMargins(marginsFromObj(j.partial_margins))
        setLegalItems(
          (j.legal_items || []).map((it: unknown) =>
            typeof it === 'string' ? it : String((it as Record<string, unknown>)?.title ?? ''),
          ),
        )
        const rp = await fetch('/api/profile/portfolio')
        const jp = await rp.json().catch(() => ({}))
        setPortfolio(
          (jp.items || []).map((it: Record<string, unknown>) => ({
            project_name: String(it.project_name ?? ''),
            description: String(it.description ?? ''),
            approx_value_cr: it.approx_value_cr == null ? '' : String(it.approx_value_cr),
            categories: Array.isArray(it.categories) ? (it.categories as string[]).join(', ') : '',
            completion_certificate: String(it.completion_certificate ?? ''),
          })),
        )
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }))
  const setMar = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setMargins((prev) => ({ ...prev, [k]: e.target.value }))
  const setRow = (i: number, k: keyof PItem) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setPortfolio((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: e.target.value } : r)))
  const setLegalRow = (i: number) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setLegalItems((p) => p.map((r, idx) => (idx === i ? e.target.value : r)))

  async function save() {
    setSaving(true)
    setMsg(null)
    let scopeKw: unknown
    try {
      scopeKw = f.scope_keywords ? JSON.parse(f.scope_keywords) : undefined
    } catch {
      setMsg('Scope keywords: invalid JSON')
      setSaving(false)
      return
    }
    const partial_margins: Record<string, number> = {}
    for (const { key } of MARGIN_FIELDS) {
      const mv = margins[key]
      if (mv != null && mv.trim() !== '' && !Number.isNaN(Number(mv))) partial_margins[key] = Number(mv)
    }
    const payload: Record<string, unknown> = {
      company_name: f.company_name || 'CS Direkt',
      scope_description: f.scope_description || '',
      include_keywords: arr(f.include_keywords || ''),
      exclude_keywords: arr(f.exclude_keywords || ''),
      auto_reject_risks: f.auto_reject_risks || '',
      analysis_instructions: f.analysis_instructions || '',
      legal_items: legalItems.map((s) => s.trim()).filter(Boolean),
      partial_margins,
      ...(scopeKw !== undefined ? { scope_keywords: scopeKw } : {}),
    }
    for (const key of NUM_KEYS) payload[key] = num(f[key] || '')

    const items = portfolio
      .filter((r) => r.project_name.trim())
      .map((r) => ({
        project_name: r.project_name.trim(),
        description: r.description.trim(),
        approx_value_cr: num(r.approx_value_cr),
        categories: arr(r.categories),
        completion_certificate: r.completion_certificate.trim(),
      }))

    try {
      const r = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (r.status === 401) {
        window.location.href = '/login'
        return
      }
      const rp = await fetch('/api/profile/portfolio', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      if (r.ok && rp.ok) {
        setF(normalize(await r.json()))
        setMsg('Saved ✓ — the rules engine & report use these on the next run')
      } else {
        setMsg('Save failed')
      }
    } catch {
      setMsg('Backend unreachable')
    } finally {
      setSaving(false)
    }
  }

  async function genKeywords() {
    setGenning(true)
    setMsg(null)
    try {
      const r = await fetch('/api/profile/generate-keywords', { method: 'POST' })
      if (r.status === 401) {
        window.location.href = '/login'
        return
      }
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        setF(normalize(j))
        setMsg('Keywords generated by Claude ✓ — review & Save')
      } else {
        setMsg(j?.error || 'Generation failed')
      }
    } finally {
      setGenning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center text-muted-foreground">
        <LoaderCircle className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <main className="h-[100dvh] overflow-y-auto bg-background px-5 py-8 sm:px-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header>
          <h1 className="font-serif text-2xl italic">Company Profile &amp; Bid Rules</h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            These settings drive the qualifier &amp; report — saved straight to Supabase
          </p>
        </header>

        <Section title="Company">
          <Field value={f.company_name || ''} onChange={set('company_name')} label="Company name" />
        </Section>

        <Section title="Financials & thresholds">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {THRESH_FIELDS.map(({ key, label, hint }) => (
              <Field key={key} value={f[key] ?? ''} onChange={set(key)} label={label} hint={hint} type="number" />
            ))}
          </div>
        </Section>

        <Section title="Bid scope & eligibility">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-foreground">What does the company do? (scope description)</span>
            <textarea value={f.scope_description || ''} onChange={set('scope_description')} rows={3} className={AREA} />
          </label>
          <button type="button" onClick={genKeywords} disabled={genning}
            className="mt-3 flex items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-amber-700 transition hover:bg-amber-400/20 disabled:opacity-50">
            {genning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate keywords from description (Claude)
          </button>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-sm text-foreground">Exclude keywords (comma-separated → reject if matched)</span>
            <textarea value={f.exclude_keywords || ''} onChange={set('exclude_keywords')} rows={2} className={AREA} />
          </label>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-sm text-foreground">Include keywords (comma-separated)</span>
            <textarea value={f.include_keywords || ''} onChange={set('include_keywords')} rows={2} className={AREA} />
          </label>

          <h3 className="mb-1 mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Financial eligibility — each with its own ± margin</h3>
          <p className="mb-3 text-[11px] text-muted-foreground">Required ≤ value → eligible (100). Required over by up to the margin → PARTIAL (highlighted). The calculator shows the ₹ swing live.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {MARGIN_FIELDS.map(({ key, label, hint }) => (
              <FinField key={key} label={label} hint={hint}
                value={f[key] ?? ''} margin={margins[key] ?? ''} onValue={set(key)} onMargin={setMar(key)} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {SCORE_FIELDS.map(({ key, label, hint }) => (
              <Field key={key} value={f[key] ?? ''} onChange={set(key)} label={label} hint={hint} type="number" />
            ))}
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-muted-foreground">Advanced: scope keywords by category (JSON)</summary>
            <textarea value={f.scope_keywords || ''} onChange={set('scope_keywords')} rows={8}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-amber-400/60" />
          </details>
        </Section>

        <Section title="Similar past work experience">
          <p className="mb-3 text-[11px] text-muted-foreground">Drives sector-wise experience check + project references in the report.</p>
          <div className="flex flex-col gap-4">
            {portfolio.map((row, i) => (
              <div key={i} className="rounded-xl border border-border p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Work title</span>
                    <input value={row.project_name} onChange={setRow(i, 'project_name')} className={INPUT} /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Value (₹ Cr)</span>
                    <input type="number" step="any" value={row.approx_value_cr} onChange={setRow(i, 'approx_value_cr')} className={INPUT} /></label>
                  <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Description</span>
                    <textarea value={row.description} onChange={setRow(i, 'description')} rows={2} className={AREA} /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Sector / category (comma)</span>
                    <input value={row.categories} onChange={setRow(i, 'categories')} className={INPUT} /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Completion certificate</span>
                    <input value={row.completion_certificate} onChange={setRow(i, 'completion_certificate')} className={INPUT} /></label>
                </div>
                <button type="button" onClick={() => setPortfolio((p) => p.filter((_, idx) => idx !== i))}
                  className="mt-2 flex items-center gap-1 text-[11px] text-red-600 hover:underline">
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setPortfolio((p) => [...p, { ...EMPTY_ROW }])}
            className="mt-4 flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-foreground transition hover:bg-muted">
            <Plus className="h-3.5 w-3.5" /> Add project
          </button>
        </Section>

        <Section title="Legal">
          <div className="flex flex-col gap-3">
            {legalItems.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={typeof row === 'string' ? row : ((row as { title?: string })?.title ?? '')} onChange={setLegalRow(i)}
                  placeholder="Mention your legal registration / compliance / asset" className={`${INPUT} flex-1`} />
                <button type="button" onClick={() => setLegalItems((p) => p.filter((_, idx) => idx !== i))}
                  className="text-red-600 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setLegalItems((p) => [...p, ''])}
            className="mt-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-foreground transition hover:bg-muted">
            <Plus className="h-3.5 w-3.5" /> Add legal item
          </button>
        </Section>

        <Section title="Others">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-foreground">Auto-reject risk factors (English — risks that warrant rejection)</span>
            <textarea value={f.auto_reject_risks || ''} onChange={set('auto_reject_risks')} rows={3}
              placeholder="e.g. Reject if it needs a foreign-OEM tie-up, demands unlimited liability, or is a pure civil-construction contract." className={AREA} />
          </label>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-sm text-foreground">Analysis instructions (English — your preferences, risk factors, rejection guidance)</span>
            <textarea value={f.analysis_instructions || ''} onChange={set('analysis_instructions')} rows={4}
              placeholder="e.g. Prefer Central/State govt clients. Treat tenders needing a foreign-OEM tie-up as high risk. Flag pure-civil works for rejection. Always prioritise heritage & museum projects."
              className={AREA} />
            <span className="text-[11px] text-muted-foreground">Claude reads this while writing the analysis &amp; recommendation.</span>
          </label>
        </Section>

        <div className="flex items-center gap-4 pb-10">
          <button type="button" onClick={save} disabled={saving}
            className="flex h-11 items-center gap-2 rounded-lg bg-amber-500 px-5 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-950 transition hover:bg-amber-400 disabled:opacity-50">
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save profile
          </button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      </div>
    </main>
  )
}
