import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import ScrollStrip from './ScrollStrip'

export type ModelRow = { model: string; mae: number; rmse: number; mape: number; r2: number; selected: boolean }
export type FcPoint = { ts: string; kwh: number; lower: number; upper: number; level: string }
export type AlertRow = { start: string; end: string; hours: number; peak_kwh: number; avg_kwh: number }
export type PerClass = { label: string; precision: number; recall: number; f1: number; support: number }
export type MlResult = {
  setup: { records: number; train_rows: number; test_rows: number; test_start: string; test_end: string; split: string; features: string[]; note: string }
  models: ModelRow[]
  best_model: string
  improvement_vs_baseline_pct: number
  backtest: { ts: string; actual: number; predicted: number }[]
  forecast: FcPoint[]
  alerts: AlertRow[]
  feature_importance: { feature: string; label: string; importance: number }[]
  classification: {
    classes: string[]
    thresholds: { low: number; high: number; low_pct?: number; high_pct?: number }
    rule: string
    accuracy: number
    macro: { precision: number; recall: number; f1: number }
    per_class: PerClass[]
    confusion_matrix: number[][]
    class_share_test: Record<string, number>
    hourly: { ts: string; actual: number; forecast: number; actual_class: string; predicted_class: string }[]
  }
}

const f1d = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })
const pct = (n: number) => (n * 100).toFixed(1) + '%'

const box: CSSProperties = { background: '#F8FAFC', padding: 16, borderRadius: 8, border: '1px solid #E2E8F0' }
const th: CSSProperties = { padding: '8px 10px', textAlign: 'left', background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', fontSize: 12 }
const td: CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #E2E8F0', fontSize: 13 }
const LEVEL_BADGE: Record<string, { fg: string; bg: string; bd: string }> = {
  'Off-Peak': { fg: '#047857', bg: '#ECFDF5', bd: '#A7F3D0' },
  Standard: { fg: '#B45309', bg: '#FFFBEB', bd: '#FDE68A' },
  'Peak-Load': { fg: '#B91C1C', bg: '#FEF2F2', bd: '#FECACA' },
}
const badge = (label: string): CSSProperties => {
  const b = LEVEL_BADGE[label] ?? LEVEL_BADGE.Standard
  return { display: 'inline-block', padding: '2px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: b.fg, background: b.bg, border: `1px solid ${b.bd}` }
}
const chip = (on: boolean, color = '#2563EB'): CSSProperties => ({
  padding: '5px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontWeight: 600,
  border: `1px solid ${on ? color : '#CBD5E1'}`, background: on ? color : '#fff', color: on ? '#fff' : '#334155',
})

export function MlStatus({ loading, error }: { loading: boolean; error: string }) {
  if (loading) {
    return (
      <section className="panel">
        <h2>Training and comparing models…</h2>
        <p className="muted">Please wait. The first run can take up to a minute, and later visits load instantly.</p>
      </section>
    )
  }
  if (error) {
    return (
      <section className="panel" style={{ borderLeft: '4px solid #F59E0B' }}>
        <h2>Machine learning analysis unavailable</h2>
        <p className="muted">{error}</p>
      </section>
    )
  }
  return null
}

/* =====================================================================
   Interactive line chart: hover tooltip, zoom in/out/reset, scroll bar to move,
   legend toggles, highlight window, and "focus" from outside controls.
   ===================================================================== */
type Series = { key: string; name: string; color: string; values: number[]; dashed?: boolean }
type Focus = { start: number; end: number } | null

function InteractiveChart({ labels, series, band, thresholds, highlight, focus, tooltipExtra, height = 260 }: {
  labels: string[]
  series: Series[]
  band?: { lower: number[]; upper: number[] }
  thresholds?: { value: number; color: string; label: string }[]
  highlight?: { start: number; end: number } | null
  focus?: Focus
  tooltipExtra?: (i: number) => string | null
  height?: number
}) {
  const W = 860, H = height, L = 48, R = 14, T = 14, B = 26
  const n = labels.length
  const [start, setStart] = useState(0)
  const [size, setSize] = useState(n)
  const [hover, setHover] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  useEffect(() => { setStart(0); setSize(n) }, [n])
  useEffect(() => {
    if (!focus) return
    const pad = Math.max(4, Math.round((focus.end - focus.start) * 0.4))
    const s = Math.max(0, focus.start - pad)
    const e = Math.min(n - 1, focus.end + pad)
    setStart(s)
    setSize(Math.max(8, e - s + 1))
  }, [focus, n])

  const sz = Math.min(Math.max(8, size), n)
  const s0 = Math.min(Math.max(0, start), Math.max(0, n - sz))
  const idx = Array.from({ length: sz }, (_, k) => s0 + k)
  const show = (k: string) => !hidden.has(k)
  const toggle = (k: string) => setHidden(h => { const c = new Set(h); if (c.has(k)) c.delete(k); else c.add(k); return c })

  const vis = series.filter(s => show(s.key))
  const pool: number[] = []
  vis.forEach(s => idx.forEach(i => pool.push(s.values[i])))
  if (band && show('band')) idx.forEach(i => { pool.push(band.upper[i], band.lower[i]) })
  if (thresholds && show('thresholds')) thresholds.forEach(t => pool.push(t.value))
  const max = (Math.max(...pool, 1)) * 1.05
  const min = Math.min(0, ...pool)
  const x = (i: number) => L + ((i - s0) / Math.max(1, sz - 1)) * (W - L - R)
  const y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B)
  const path = (vals: number[]) => idx.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ')
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => min + t * (max - min))
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(t => s0 + Math.round(t * (sz - 1)))

  const hi = highlight && highlight.end >= s0 && highlight.start <= s0 + sz - 1 ? highlight : null
  const active = hover === null ? null : hover

  return (
    <div className="chart-wrap" style={{ position: 'relative' }}>
      <div className="export-actions" style={{ marginBottom: 8 }}>
        <button type="button" className="secondary" onClick={() => setSize(Math.max(8, Math.floor(sz * 0.6)))}>Zoom in</button>
        <button type="button" className="secondary" onClick={() => setSize(Math.min(n, Math.ceil(sz * 1.6)))}>Zoom out</button>
        <button type="button" className="secondary" onClick={() => { setStart(0); setSize(n) }}>Reset</button>
        <span className="muted" style={{ fontSize: 13 }}>Zoom in, then scroll left and right with the bar under the chart. Hover for exact values. Click the legend to show or hide lines.</span>
      </div>
      {active !== null && (
        <div className="chart-tooltip" style={{ fontSize: 13, padding: '10px 14px' }}>
          <b>{labels[active]}</b>
          {vis.map(s => (<div key={s.key}>{s.name}: <b>{f1d(s.values[active])} kWh</b></div>))}
          {band && show('band') && <div>Range: {f1d(band.lower[active])} – {f1d(band.upper[active])} kWh</div>}
          {tooltipExtra?.(active) && <div>{tooltipExtra(active)}</div>}
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', cursor: 'crosshair' }}
        role="img"
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          const k = Math.round(((px - L) / (W - L - R)) * (sz - 1))
          setHover(Math.min(s0 + sz - 1, Math.max(s0, s0 + k)))
        }}
      >
        {yTicks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#E2E8F0" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#64748B">{Math.round(t)}</text>
          </g>
        ))}
        {xTicks.map((i, k) => (
          <text key={k} x={x(i)} y={H - 8} textAnchor={k === 0 ? 'start' : k === 4 ? 'end' : 'middle'} fontSize="10" fill="#64748B">
            {labels[i]?.slice(5, 16)}
          </text>
        ))}
        {hi && (
          <rect x={x(Math.max(hi.start, s0))} width={Math.max(3, x(Math.min(hi.end, s0 + sz - 1)) - x(Math.max(hi.start, s0)))}
            y={T} height={H - T - B} fill="#DC2626" opacity="0.13" />
        )}
        {band && show('band') && (
          <path
            d={`${idx.map((i, k) => `${k ? 'L' : 'M'}${x(i)},${y(band.upper[i])}`).join(' ')} ${[...idx].reverse().map(i => `L${x(i)},${y(band.lower[i])}`).join(' ')} Z`}
            fill="#3B82F6" opacity="0.12"
          />
        )}
        {thresholds && show('thresholds') && thresholds.map(t => (
          <g key={t.label}>
            <line x1={L} x2={W - R} y1={y(t.value)} y2={y(t.value)} stroke={t.color} strokeDasharray="4 4" />
            <text x={W - R - 2} y={y(t.value) - 4} textAnchor="end" fontSize="10" fill={t.color}>{t.label}</text>
          </g>
        ))}
        {vis.map(s => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="1.8" strokeDasharray={s.dashed ? '5 3' : undefined} />
        ))}
        {active !== null && (
          <g>
            <line x1={x(active)} x2={x(active)} y1={T} y2={H - B} stroke="#94A3B8" strokeDasharray="3 3" />
            {vis.map(s => <circle key={s.key} cx={x(active)} cy={y(s.values[active])} r="4.5" fill={s.color} stroke="#fff" strokeWidth="1.5" />)}
          </g>
        )}
      </svg>
      <ScrollStrip total={n} size={sz} start={s0} onStart={setStart} />
      <div style={{ display: 'flex', gap: 14, fontSize: 12, marginTop: 6, flexWrap: 'wrap' }}>
        {series.map(s => (
          <button key={s.key} onClick={() => toggle(s.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: show(s.key) ? 1 : 0.35, color: '#334155' }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: s.color, borderRadius: 2, marginRight: 6 }} />{s.name}
          </button>
        ))}
        {band && (
          <button onClick={() => toggle('band')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: show('band') ? 1 : 0.35, color: '#334155' }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: '#BFDBFE', borderRadius: 2, marginRight: 6 }} />95% range
          </button>
        )}
        {thresholds && (
          <button onClick={() => toggle('thresholds')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: show('thresholds') ? 1 : 0.35, color: '#334155' }}>
            <span style={{ display: 'inline-block', width: 10, height: 2, background: '#DC2626', marginRight: 6, verticalAlign: 'middle' }} />Thresholds
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------- Objective 2: model comparison ---------- */
type Metric = 'mape' | 'rmse' | 'mae' | 'r2'
const METRIC_INFO: Record<Metric, { label: string; better: 'lower' | 'higher'; fmt: (v: number) => string }> = {
  mape: { label: 'MAPE', better: 'lower', fmt: v => v.toFixed(2) + '%' },
  rmse: { label: 'RMSE (kWh)', better: 'lower', fmt: f1d },
  mae: { label: 'MAE (kWh)', better: 'lower', fmt: f1d },
  r2: { label: 'R²', better: 'higher', fmt: v => v.toFixed(3) },
}

export function ModelComparison({ ml }: { ml: MlResult }) {
  const [metric, setMetric] = useState<Metric>('mape')
  const [picked, setPicked] = useState<string>(ml.best_model)
  const info = METRIC_INFO[metric]
  const sorted = useMemo(
    () => [...ml.models].sort((a, b) => (info.better === 'lower' ? a[metric] - b[metric] : b[metric] - a[metric])),
    [ml.models, metric, info.better],
  )
  const worst = Math.max(...ml.models.map(m => Math.abs(m[metric])), 0.0001)
  const sel = ml.models.find(m => m.model === picked) ?? ml.models[0]
  const base = ml.models.find(m => m.model.toLowerCase().startsWith('seasonal naive'))
  const gain = base && base.rmse ? ((base.rmse - sel.rmse) / base.rmse) * 100 : null
  const errAt = (i: number) => {
    const b = ml.backtest[i]
    return b ? `Error: ${f1d(b.predicted - b.actual)} kWh (${(Math.abs((b.predicted - b.actual) / (b.actual || 1)) * 100).toFixed(1)}%)` : null
  }
  return (
    <section className="panel" style={{ borderLeft: '4px solid #2563EB' }}>
      <div className="panel-head">
        <div>
          <h2>Forecasting model comparison</h2>
          <p className="muted">
            Every model was trained on older data and tested on days it had never seen. {ml.setup.split} ({ml.setup.test_rows.toLocaleString()} hourly test records).
          </p>
        </div>
        <span className="tag" style={{ background: '#EFF6FF', color: '#1D4ED8' }}>Selected: {ml.best_model}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 13 }}>Compare by:</span>
        {(Object.keys(METRIC_INFO) as Metric[]).map(m => (
          <button key={m} onClick={() => setMetric(m)} style={chip(metric === m)}>{METRIC_INFO[m].label}</button>
        ))}
        <span className="muted" style={{ fontSize: 12 }}>({info.better} is better). Click a model to inspect it.</span>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {sorted.map((m, rank) => (
          <div key={m.model} onClick={() => setPicked(m.model)}
            style={{ display: 'grid', gridTemplateColumns: '230px 1fr 80px', gap: 10, alignItems: 'center', cursor: 'pointer', padding: '6px 8px', borderRadius: 8,
              background: picked === m.model ? '#EFF6FF' : 'transparent', border: picked === m.model ? '1px solid #93C5FD' : '1px solid transparent' }}>
            <span style={{ fontSize: 13, fontWeight: m.selected ? 700 : 500 }}>
              {rank + 1}. {m.model}{m.selected ? ' ✓' : ''}
            </span>
            <div style={{ background: '#E2E8F0', borderRadius: 4, height: 14 }}>
              <div style={{ width: `${(Math.abs(m[metric]) / worst) * 100}%`, height: '100%', borderRadius: 4, background: m.selected ? '#2563EB' : '#94A3B8', transition: 'width .25s' }} />
            </div>
            <b style={{ fontSize: 13, textAlign: 'right' }}>{info.fmt(m[metric])}</b>
          </div>
        ))}
      </div>

      <div style={{ ...box, marginTop: 12, fontSize: 13 }}>
        <b>{sel.model}</b>: MAE {f1d(sel.mae)} kWh · RMSE {f1d(sel.rmse)} kWh · MAPE {sel.mape.toFixed(2)}% · R² {sel.r2.toFixed(3)}.
        {gain !== null && !sel.model.toLowerCase().startsWith('seasonal naive') && (
          <> Its RMSE is <b>{gain.toFixed(0)}% {gain >= 0 ? 'lower' : 'higher'}</b> than simply repeating last week's usage.</>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Inputs used: {ml.setup.features.join(', ')}. {ml.setup.note}
      </p>

      <h3 style={{ fontSize: 14, margin: '14px 0 4px' }}>Last 7 test days: actual vs predicted ({ml.best_model})</h3>
      <InteractiveChart
        labels={ml.backtest.map(b => b.ts)}
        series={[
          { key: 'actual', name: 'Actual', color: '#0F172A', values: ml.backtest.map(b => b.actual) },
          { key: 'pred', name: 'Predicted', color: '#2563EB', values: ml.backtest.map(b => b.predicted), dashed: true },
        ]}
        tooltipExtra={errAt}
      />
    </section>
  )
}

/* ---------- Objective 2: 7-day forecast + alerts ---------- */
export function ForecastAlerts({ ml }: { ml: MlResult }) {
  const t = ml.classification.thresholds
  const [focus, setFocus] = useState<Focus>(null)
  const [activeAlert, setActiveAlert] = useState<string | null>(null)
  const [activeDay, setActiveDay] = useState<string>('all')
  const [showAll, setShowAll] = useState(false)

  const idxOf = (ts: string) => ml.forecast.findIndex(f => f.ts === ts)
  const days = useMemo(() => {
    const map = new Map<string, { start: number; end: number; peaks: number }>()
    ml.forecast.forEach((f, i) => {
      const d = f.ts.slice(0, 10)
      const cur = map.get(d) ?? { start: i, end: i, peaks: 0 }
      cur.end = i
      if (f.level === 'Peak-Load') cur.peaks += 1
      map.set(d, cur)
    })
    return [...map.entries()].map(([date, v]) => ({ date, ...v }))
  }, [ml.forecast])
  const weekday = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

  const alertRange = activeAlert
    ? (() => { const a = ml.alerts.find(x => x.start === activeAlert); return a ? { start: idxOf(a.start), end: idxOf(a.end) } : null })()
    : null
  const shown = showAll ? ml.alerts : ml.alerts.slice(0, 6)

  return (
    <section className="panel" style={{ borderLeft: '4px solid #DC2626' }}>
      <div className="panel-head">
        <div>
          <h2>Next 7 days: hourly forecast &amp; peak-load alerts</h2>
          <p className="muted">
            Forecast from {ml.forecast[0].ts} to {ml.forecast[ml.forecast.length - 1].ts}. The shaded area is an approximate 95% range from the model's test error.
          </p>
        </div>
        <span className="tag" style={{ background: ml.alerts.length ? '#FEF2F2' : '#ECFDF5', color: ml.alerts.length ? '#DC2626' : '#047857' }}>
          {ml.alerts.length ? `${ml.alerts.length} peak-load alert${ml.alerts.length > 1 ? 's' : ''}` : 'No peak-load expected'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button style={chip(activeDay === 'all')} onClick={() => { setActiveDay('all'); setActiveAlert(null); setFocus({ start: 0, end: ml.forecast.length - 1 }) }}>All 7 days</button>
        {days.map(d => (
          <button key={d.date} style={chip(activeDay === d.date, d.peaks ? '#DC2626' : '#2563EB')}
            onClick={() => { setActiveDay(d.date); setActiveAlert(null); setFocus({ start: d.start, end: d.end }) }}>
            {weekday(d.date)}{d.peaks ? ` · ${d.peaks} peak h` : ''}
          </button>
        ))}
      </div>

      <InteractiveChart
        labels={ml.forecast.map(f => f.ts)}
        series={[{ key: 'fc', name: 'Forecast', color: '#2563EB', values: ml.forecast.map(f => f.kwh) }]}
        band={{ lower: ml.forecast.map(f => f.lower), upper: ml.forecast.map(f => f.upper) }}
        thresholds={[
          { value: t.high, color: '#DC2626', label: `Peak-Load above ${f1d(t.high)} kWh` },
          { value: t.low, color: '#10B981', label: `Off-Peak up to ${f1d(t.low)} kWh` },
        ]}
        highlight={alertRange}
        focus={focus}
        tooltipExtra={i => `Level: ${ml.forecast[i].level}`}
      />

      {ml.alerts.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>⚠ System alerts <span className="muted" style={{ fontWeight: 400 }}>(click one to zoom to it)</span></h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {shown.map(a => (
              <button key={a.start} onClick={() => { setActiveAlert(a.start); setActiveDay('all'); setFocus({ start: idxOf(a.start), end: idxOf(a.end) }) }}
                style={{ ...box, padding: '10px 14px', borderLeft: '4px solid #DC2626', fontSize: 13, textAlign: 'left', cursor: 'pointer',
                  outline: activeAlert === a.start ? '2px solid #DC2626' : 'none' }}>
                <b>{a.start}{a.hours > 1 ? ` → ${a.end.slice(11)}` : ''}</b> · {a.hours} hour{a.hours > 1 ? 's' : ''} of Peak-Load expected
                (up to <b>{f1d(a.peak_kwh)} kWh</b>). Consider shifting flexible loads out of this window.
              </button>
            ))}
          </div>
          {ml.alerts.length > 6 && (
            <button onClick={() => setShowAll(s => !s)} style={{ marginTop: 8, background: 'none', border: 'none', color: '#2563EB', cursor: 'pointer', fontSize: 13 }}>
              {showAll ? 'Show fewer' : `Show all ${ml.alerts.length} alerts`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

/* ---------- Objective 4: appliance contribution + forecast influence (one card) ---------- */
const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
/** "equipment_HVAC_lag_168h" or "HVAC usage (previous week)" -> "hvac" ; anything else -> null */
export function applianceKey(f: { feature: string; label: string }): string | null {
  const m = /^equipment_(.+?)(?:_lag_\d+h)?$/i.exec(f.feature)
  if (m) return squash(m[1])
  const l = /^(.+?)\s+usage\s+\(previous week\)$/i.exec(f.label)
  return l ? squash(l[1]) : null
}

export function ApplianceInfluence({ appliances, ml, loading, error }: {
  appliances: { name: string; kwh: number }[]
  ml: MlResult | null
  loading: boolean
  error: string
}) {
  const [sortBy, setSortBy] = useState<'kwh' | 'influence'>('kwh')
  const [hov, setHov] = useState<string | null>(null)

  const totalKwh = appliances.reduce((a, x) => a + x.kwh, 0) || 1
  const feats = ml?.feature_importance ?? []
  const byApp = new Map<string, { importance: number; rank: number }>()
  feats.forEach((f, i) => {
    const key = applianceKey(f)
    if (key) byApp.set(key, { importance: f.importance, rank: i + 1 })
  })

  // Appliances and non-appliance model features are combined into one list.
  const applianceRows = appliances.map(a => {
    const match = byApp.get(squash(a.name))
    return {
      id: `appliance-${a.name}`,
      name: a.name,
      kwh: a.kwh,
      share: a.kwh / totalKwh,
      influence: match?.importance ?? null,
      rank: match?.rank ?? null,
      isAppliance: true,
    }
  })

  const otherRows = feats
    .filter(f => applianceKey(f) === null || !appliances.some(a => squash(a.name) === applianceKey(f)))
    .map((f, i) => ({
      id: `factor-${f.feature}`,
      name: f.label,
      kwh: null as number | null,
      share: null as number | null,
      influence: f.importance,
      rank: feats.findIndex(x => x.feature === f.feature) + 1 || i + 1,
      isAppliance: false,
    }))

  const combinedRows = [...applianceRows, ...otherRows].sort((a, b) =>
    sortBy === 'influence'
      ? (b.influence ?? -1) - (a.influence ?? -1)
      : (b.share ?? -1) - (a.share ?? -1)
  )
  const maxShare = Math.max(...applianceRows.map(r => r.share), 0.0001)
  const maxInfluence = Math.max(...combinedRows.map(r => r.influence ?? 0), 0.0001)
  const hovered = combinedRows.find(r => r.id === hov)
  const n0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

  return (
    <section className="panel" style={{ borderLeft: '4px solid #7C3AED' }}>
      <div className="panel-head">
        <div>
          <h2>Energy consumption factors &amp; forecast influence</h2>
          <p className="muted">
            <span style={{ color: '#059669', fontWeight: 700 }}>Green</span> = share of the building's electricity used by an appliance.{' '}
            <span style={{ color: '#7C3AED', fontWeight: 700 }}>Purple</span> = how strongly the model relies on an input when forecasting
            {ml ? ` (permutation importance, ${ml.best_model})` : ''}.
            Factors such as time and weather do not have appliance kWh usage.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button style={chip(sortBy === 'kwh', '#059669')} onClick={() => setSortBy('kwh')}>Sort by usage</button>
          <button style={chip(sortBy === 'influence', '#7C3AED')} onClick={() => setSortBy('influence')} disabled={!ml}>Sort by influence</button>
        </div>
      </div>

      {loading && !ml && <p className="muted" style={{ fontSize: 13 }}>Forecast influence is being calculated (this can take up to a minute). Usage is shown below.</p>}
      {error && !ml && <p style={{ fontSize: 13, color: '#B45309' }}>Forecast influence is unavailable: {error}</p>}

      {combinedRows.length === 0 ? (
        <p className="muted">No appliance or forecasting-factor data available.</p>
      ) : (
        <div style={{
          display: 'grid',
          gap: 8,
          marginTop: 12,
          maxHeight: 560,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingRight: 8,
        }}>
          {combinedRows.map(r => (
            <div
              key={r.id}
              onMouseEnter={() => setHov(r.id)}
              onMouseLeave={() => setHov(null)}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: hov === r.id ? '#F5F3FF' : 'transparent',
                border: '1px solid #E2E8F0',
                transition: 'background .15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: '#1E293B' }}>
                  {r.name}
                  <span style={{ marginLeft: 8, fontSize: 10, color: '#64748B', fontWeight: 500 }}>
                    {r.isAppliance ? 'APPLIANCE' : 'FORECAST FACTOR'}
                  </span>
                </span>
                <span style={{ whiteSpace: 'nowrap' }}>
                  {r.isAppliance && r.share !== null ? (
                    <span style={{ color: '#059669' }}>{(r.share * 100).toFixed(1)}% of kWh · {n0(r.kwh ?? 0)} kWh</span>
                  ) : (
                    <span style={{ color: '#94A3B8' }}>No appliance kWh</span>
                  )}
                  <span style={{ color: '#7C3AED' }}> · {r.influence !== null ? `${pct(r.influence)} influence` : 'Influence unavailable'}</span>
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '58px 1fr', alignItems: 'center', gap: 6, marginTop: 7 }}>
                <span style={{ color: '#059669', fontSize: 11 }}>Usage</span>
                <div style={{ background: '#E2E8F0', borderRadius: 9999, height: 7, overflow: 'hidden' }}>
                  {r.share !== null && (
                    <div style={{ width: `${Math.max(2, (r.share / maxShare) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #10B981, #14B8A6)', borderRadius: 9999 }} />
                  )}
                </div>
                <span style={{ color: '#7C3AED', fontSize: 11 }}>Influence</span>
                <div style={{ background: '#EDE9FE', borderRadius: 9999, height: 7, overflow: 'hidden' }}>
                  {r.influence !== null && (
                    <div style={{ width: `${Math.max(2, (r.influence / maxInfluence) * 100)}%`, height: '100%', background: '#7C3AED', borderRadius: 9999 }} />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 10, minHeight: 20 }}>
        {hovered
          ? hovered.isAppliance
            ? `${hovered.name} uses ${((hovered.share ?? 0) * 100).toFixed(1)}% of the building's electricity (${n0(hovered.kwh ?? 0)} kWh). ${hovered.influence !== null ? `It accounts for ${pct(hovered.influence)} of forecast influence (rank #${hovered.rank} of ${feats.length} inputs).` : 'Its forecast influence is not available.'}`
            : `${hovered.name} contributes ${pct(hovered.influence ?? 0)} of the model's forecast influence (rank #${hovered.rank} of ${feats.length} inputs).`
          : 'Appliances and forecasting factors are shown together. A large electricity user is not necessarily the strongest forecasting clue.'}
      </p>
    </section>
  )
}

/* ---------- Objective 3 + 5: peak-load classification ---------- */
export function ClassificationPanel({ ml, onApplyThresholds, busy }: {
  ml: MlResult
  onApplyThresholds?: (low: number, high: number) => void
  busy?: boolean
}) {
  const c = ml.classification
  const curLow = c.thresholds.low_pct ?? 40
  const curHigh = c.thresholds.high_pct ?? 85
  const [low, setLow] = useState(curLow)
  const [high, setHigh] = useState(curHigh)
  useEffect(() => { setLow(curLow); setHigh(curHigh) }, [curLow, curHigh])

  const hourly = c.hourly ?? []
  const days = useMemo(() => Array.from(new Set(hourly.map(h => h.ts.slice(0, 10)))), [hourly])
  const [day, setDay] = useState('')
  const activeDay = days.includes(day) ? day : days[days.length - 1] ?? ''
  const dayRows = useMemo(() => hourly.filter(h => h.ts.startsWith(activeDay)), [hourly, activeDay])
  const dayMatches = dayRows.filter(h => h.actual_class === h.predicted_class).length
  const dayLabel = activeDay ? new Date(activeDay + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''

  const changed = low !== curLow || high !== curHigh
  const cards = [
    { label: 'Accuracy', value: c.accuracy, color: '#10B981', note: 'Share of hours labelled correctly' },
    { label: 'Precision (macro)', value: c.macro.precision, color: '#2563EB', note: 'When it says a level, how often it is right' },
    { label: 'Recall (macro)', value: c.macro.recall, color: '#7C3AED', note: 'How many real hours of each level it caught' },
    { label: 'F1-score (macro)', value: c.macro.f1, color: '#D97706', note: 'Balance of precision and recall' },
  ]
  return (
    <section className="panel" style={{ borderLeft: '4px solid #10B981' }}>
      <div className="panel-head">
        <div>
          <h2>Peak-load classification: Off-Peak, Standard, Peak-Load</h2>
          <p className="muted">{c.rule}. Metrics use the {ml.setup.test_rows.toLocaleString()} test hours the model never saw.</p>
        </div>
      </div>

      {onApplyThresholds && (
        <div style={{ ...box, marginBottom: 14 }}>
          <b style={{ fontSize: 13 }}>Try different level cutoffs</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 8 }}>
            <label style={{ fontSize: 13 }}>
              Off-Peak up to the <b>{low}th</b> percentile
              <input type="range" min={10} max={Math.min(70, high - 5)} value={low} onChange={e => setLow(Number(e.target.value))} style={{ width: '100%' }} />
            </label>
            <label style={{ fontSize: 13 }}>
              Peak-Load above the <b>{high}th</b> percentile
              <input type="range" min={Math.max(60, low + 5)} max={98} value={high} onChange={e => setHigh(Number(e.target.value))} style={{ width: '100%' }} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" disabled={!changed || busy} onClick={() => onApplyThresholds(low, high)}>{busy ? 'Retraining…' : 'Apply and retrain'}</button>
            <button type="button" className="secondary" onClick={() => { setLow(40); setHigh(85) }}>Back to 40 / 85</button>
            <span className="muted" style={{ fontSize: 12 }}>Retraining can take up to a minute. Every cutoff you try is remembered for next time.</span>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        {cards.map(k => (
          <div key={k.label} style={box}>
            <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>{k.label}</span>
            <p style={{ fontSize: 24, fontWeight: 700, color: k.color, margin: '4px 0 2px' }}>{pct(k.value)}</p>
            <span style={{ fontSize: 11, color: '#94A3B8' }}>{k.note}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '18px 0 8px' }}>
        <div>
          <h3 style={{ fontSize: 14, margin: 0 }}>Hourly Classification Table</h3>
          <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>
            Actual vs. predicted load categories{dayLabel ? ` · ${dayLabel}` : ''} · {dayMatches} of {dayRows.length} hours match
          </p>
        </div>
        <label style={{ fontSize: 12 }}>
          Test day{' '}
          <select value={activeDay} onChange={e => setDay(e.target.value)} style={{ padding: '4px 8px', fontSize: 12 }}>
            {[...days].reverse().map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 420, border: '1px solid #E2E8F0', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Hour', 'Actual (kWh)', 'Forecast (kWh)', 'Actual class', 'Predicted class', 'Match'].map(h => (
                <th key={h} style={{ ...th, position: 'sticky', top: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dayRows.map(r => {
              const ok = r.actual_class === r.predicted_class
              return (
                <tr key={r.ts}>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{r.ts.slice(11, 16)}</td>
                  <td style={td}>{f1d(r.actual)}</td>
                  <td style={{ ...td, color: '#D97706' }}>{f1d(r.forecast)}</td>
                  <td style={td}><span style={badge(r.actual_class)}>{r.actual_class}</span></td>
                  <td style={td}><span style={badge(r.predicted_class)}>{r.predicted_class}</span></td>
                  <td style={{ ...td, color: ok ? '#10B981' : '#DC2626', fontWeight: 700 }}>{ok ? '✓' : '✗'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Peak-Load is the hardest level: only {pct(c.class_share_test['Peak-Load'] ?? 0)} of test hours are peaks and their size depends on things nobody can know in advance.
      </p>
    </section>
  )
}