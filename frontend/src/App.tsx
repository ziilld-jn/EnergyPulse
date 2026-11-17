import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Login from './components/Login'
import AdminAccounts from './components/AdminAccounts'
import { API, authFetch, getToken, setToken, setUnauthorizedHandler } from './auth'
import type { User } from './auth'
import Sidebar from './components/Sidebar'
import DatasetUpload from './components/DatasetUpload'
import Buildings from './components/Buildings'
import type { Building } from './components/Buildings'
import SeasonalForecast from './components/SeasonalForecast'
import type { ForecastPoint, MonthPoint, Regression } from './components/SeasonalForecast'
import { MlStatus, ModelComparison, ForecastAlerts, ApplianceInfluence, ClassificationPanel } from './components/MlInsights'
import type { MlResult } from './components/MlInsights'

type Point = {
  x: number
  date: string
  energy: number
}

type Analytics = {
  filename: string
  records: number
  energy_column: string
  date_column: string | null
  total_kwh: number
  average_kwh: number
  peak_kwh: number
  minimum_kwh: number
  peak_kw: number | null
  cost_php: number
  rate_php_per_kwh: number
  series: Point[]
  monthly: {
    month: string
    month_number: number
    kwh: number
  }[]
  appliances: {
    name: string
    kwh: number
    average_kw?: number | null
    peak_kw?: number | null
    peak_hour?: number | null
    hourly_profile?: { hour: number; average_kwh: number }[]
  }[]
  dates: {
    start: string | null
    end: string | null
  }
  monthly_history?: MonthPoint[]
  forecast_2026?: ForecastPoint[]
  yoy_change?: number | null
  regression?: Regression | null
}

const money = (n: number) =>
  '₱' + n.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })

const num = (n: number) =>
  n.toLocaleString('en-PH', {
    maximumFractionDigits: 2
  })

function Chart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null)

  const W = 900
  const H = 260
  const pad = 42

  const plotted = useMemo(() => {
    const step = Math.max(1, Math.ceil(data.length / 600))
    return data
      .map((d, i) => ({ d, i }))
      .filter(({ i }) => i % step === 0 || i === data.length - 1)
  }, [data])

  const max = Math.max(1, ...plotted.map(({ d }) => d.energy))
  const min = Math.min(0, ...plotted.map(({ d }) => d.energy))

  const xy = (d: Point, i: number) => ({
    x: pad + (i / Math.max(1, plotted.length - 1)) * (W - pad * 2),
    y: H - pad - ((d.energy - min) / (max - min || 1)) * (H - pad * 2)
  })

  const path = plotted
    .map(({ d }, i) => {
      const q = xy(d, i)
      return `${i ? 'L' : 'M'}${q.x},${q.y}`
    })
    .join(' ')

  const active = hover === null ? null : plotted[hover] ?? null

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Energy consumption line chart">
        {[0, 1, 2, 3, 4].map(i => (
          <g key={i}>
            <line
              x1={pad}
              x2={W - pad}
              y1={pad + i * (H - pad * 2) / 4}
              y2={pad + i * (H - pad * 2) / 4}
              stroke="#E2E8F0"
            />
            <text x="8" y={pad + i * (H - pad * 2) / 4 + 4} fill="#64748B" fontSize="11">
              {num(max - i * (max - min) / 4)}
            </text>
          </g>
        ))}

        <path d={path} fill="none" stroke="#10B981" strokeWidth="3" strokeLinejoin="round" />

        {plotted.map(({ d, i }, j) => {
          const q = xy(d, j)
          return (
            <circle
              key={i}
              cx={q.x}
              cy={q.y}
              r={hover === j ? 6 : 2.5}
              fill={hover === j ? '#EF4444' : '#14B8A6'}
              onMouseEnter={() => setHover(j)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${d.date}: ${num(d.energy)} kWh`}</title>
            </circle>
          )
        })}

        <text x={pad} y={H - 8} fill="#64748B" fontSize="11">
          {data[0]?.date ?? 'First record'}
        </text>
        <text x={W - pad} y={H - 8} textAnchor="end" fill="#64748B" fontSize="11">
          {data[data.length - 1]?.date ?? 'Last record'}
        </text>
      </svg>

      {active && (
        <div className="chart-tooltip">
          Record {active.i + 1} · {active.d.date}
          <br />
          <b>{num(active.d.energy)} kWh</b>
        </div>
      )}

      <p className="chart-caption">
        X-axis: timestamp / record sequence · Y-axis: energy consumption (kWh). Hover for exact values.
        {data.length > 600 ? ` Displaying ${plotted.length} representative points from ${data.length} records.` : ''}
      </p>
    </div>
  )
}

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [apiStatus, setApiStatus] = useState('Checking')
  const [page, setPage] = useState(user.role === 'admin' ? 'Admin Dashboard' : 'Overview')
  const [filename, setFilename] = useState(localStorage.getItem('ep_dataset') || '')
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState('')
  const [rate, setRate] = useState(15.06)
  const [ml, setMl] = useState<MlResult | null>(null)
  const [mlLoading, setMlLoading] = useState(false)
  const [mlError, setMlError] = useState('')
  const [cuts, setCuts] = useState({ low: 40, high: 85 })
  const mlFile = useRef('')
  const [buildings, setBuildings] = useState<Building[]>([])
  const [buildingId, setBuildingId] = useState(localStorage.getItem('ep_building') || '')
  const building = buildings.find(b => b.id === buildingId) ?? null

  const [buildingsReady, setBuildingsReady] = useState(user.role === 'admin')
  // The building to analyse inside the selected CSV ('' = the whole file)
  const buildingParam = building && building.dataset === filename ? building.building : ''
  // Only analyse once the selected building and its CSV agree, so no wasted early requests
  const dataReady = buildingsReady && (buildings.length === 0 || (!!building && building.dataset === filename))

  const loadBuildings = useCallback(async (): Promise<Building[]> => {
    if (user.role === 'admin') return []
    try {
      const r = await authFetch(`${API}/api/buildings`)
      if (r.ok) {
        const list = await r.json() as Building[]
        setBuildings(list)
        return list
      }
    } catch { /* backend offline: the status badge already says so */ }
    finally { setBuildingsReady(true) }
    return []
  }, [user.role])

  useEffect(() => { void loadBuildings() }, [loadBuildings])

  useEffect(() => {
    fetch(API + '/health')
      .then(r => setApiStatus(r.ok ? 'Connected' : 'Offline'))
      .catch(() => setApiStatus('Offline'))
  }, [])

  useEffect(() => {
    if (!filename || !dataReady) return
    let cancelled = false

    authFetch(`${API}/api/datasets/${encodeURIComponent(filename)}/analytics?building=${encodeURIComponent(buildingParam)}`)
      .then(r => r.json().then(j => {
        if (!r.ok) throw Error(j.detail || 'Analytics failed')
        return j
      }))
      .then(d => {
        if (!cancelled) {
          setData(d)
          if (typeof d.rate_php_per_kwh === 'number' && d.rate_php_per_kwh > 0) {
            setRate(Number(d.rate_php_per_kwh.toFixed(4)))
          }
          setError('')
        }
      })
      .catch(e => {
        if (!cancelled) {
          setError(e.message)
          setData(null)
        }
      })

    return () => { cancelled = true }
  }, [filename, buildingParam, dataReady])

  // Machine-learning results (model comparison, forecast, classifier, importance)
  useEffect(() => {
    if (!filename || !dataReady) return
    let cancelled = false
    setMlLoading(true)
    setMlError('')
    const mlKey = `${filename}|${buildingParam}`
    if (mlFile.current !== mlKey) { setMl(null); mlFile.current = mlKey }
    authFetch(`${API}/api/datasets/${encodeURIComponent(filename)}/ml?low_pct=${cuts.low}&high_pct=${cuts.high}&building=${encodeURIComponent(buildingParam)}`)
      .then(r => r.json().then(j => {
        if (!r.ok) throw Error(j.detail || 'ML analysis failed')
        return j as MlResult
      }))
      .then(j => { if (!cancelled) setMl(j) })
      .catch(e => { if (!cancelled) setMlError(e.message) })
      .finally(() => { if (!cancelled) setMlLoading(false) })
    return () => { cancelled = true }
  }, [filename, buildingParam, dataReady, cuts.low, cuts.high])

  const chooseDataset = (f: string) => {
    setFilename(f)
    localStorage.setItem('ep_dataset', f)
    setError('')
  }

  const handleDatasetDeleted = (deletedFilename: string) => {
    if (deletedFilename === filename) {
      setFilename('')
      localStorage.removeItem('ep_dataset')
      setData(null)
    }
    void loadBuildings()
  }

  // Switch the whole dashboard to one building (its CSV rows drive every page)
  const selectBuilding = (id: string, list: Building[] = buildings) => {
    const b = list.find(x => x.id === id)
    if (!b) return
    setBuildingId(id)
    localStorage.setItem('ep_building', id)
    chooseDataset(b.dataset)
  }

  // Keep the selected building valid, and its CSV loaded, once the list arrives
  useEffect(() => {
    if (!buildings.length) return
    const cur = buildings.find(b => b.id === buildingId)
    if (!cur) selectBuilding((buildings.find(b => b.dataset === filename) ?? buildings[0]).id, buildings)
    else if (cur.dataset !== filename) chooseDataset(cur.dataset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings])

  // "Load Dataset" in Dataset Management: open the first building found in that CSV
  const loadDatasetFile = async (f: string) => {
    const list = await loadBuildings()
    const first = list.find(b => b.dataset === f)
    if (first) selectBuilding(first.id, list)
    else chooseDataset(f)
  }

  const d = data
  const monthly = (d?.monthly_history?.length
    ? d.monthly_history.map(m => ({ month: m.label, month_number: m.month_number, kwh: m.kwh }))
    : d?.monthly) || []

  const peakMonth = monthly.reduce(
    (a, b) => b.kwh > a.kwh ? b : a,
    { month: '', month_number: 0, kwh: 0 }
  )

  // Admins can only see the accounts page, whatever page state says
  const route = (user.role === 'admin' ? 'Admin Dashboard' : page).toLowerCase()
  const section =
    route.includes('admin') ? 'admin' :
    route.includes('dataset') ? 'dataset' :
    route.includes('building') ? 'buildings' :
    route === 'fc' || route.includes('forecast') ? 'forecast' :
    route === 'pl' || route.includes('plan') || route.includes('peak') ? 'planning' :
    route === 'rp' || route.includes('report') ? 'reports' :
    route === 'en' || route.includes('consumption') ? 'consumption' :
    'overview'

  const title =
    section === 'admin' ? 'Admin Dashboard' :
    section === 'forecast' ? 'Forecasting' :
    section === 'planning' ? 'Peak-Load & Energy Planning' :
    section === 'reports' ? 'Reports & Summary' :
    section === 'consumption' ? 'Energy Consumption Analysis' :
    section === 'dataset' ? 'Dataset Management' :
    section === 'buildings' ? 'Buildings' :
    'System Overview'

  const cards = d ? [
    { label: 'Total Consumption', v: num(d.total_kwh) + ' kWh', c: 'blue', desc: 'Sum of valid energy records' },
    { label: 'Average Consumption', v: num(d.average_kwh) + ' kWh', c: 'green', desc: 'Mean energy per record' },
    { label: 'Peak Consumption', v: num(d.peak_kwh) + ' kWh', c: 'red', desc: 'Highest recorded energy value' },
    { label: 'Minimum Consumption', v: num(d.minimum_kwh) + ' kWh', c: 'teal', desc: 'Lowest recorded energy value' },
    { label: 'Records', v: num(d.records), c: 'purple', desc: 'Valid numeric observations' },
    { label: 'Estimated Cost', v: money(d.total_kwh * rate), c: 'orange', desc: `At ₱${rate.toFixed(2)}/kWh` }
  ] : []

  return (
    <div className="shell">
      <Sidebar activePage={page} onNavigate={setPage} userName={user.name} userRole={user.role} onLogout={onLogout} />

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">ENERGY MONITORING & MANAGEMENT</p>
            <h1>{title}</h1>
            <p className="muted">
              EnergyPulse 2.0 · {building ? `${building.name} · ` : ''}{d?.dates.start ? `${d.dates.start} — ${d.dates.end}` : 'Professional Energy Analytics Platform'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {user.role !== 'admin' && buildings.length > 0 && (
              <select
                aria-label="Select building"
                value={buildingId}
                onChange={e => selectBuilding(e.target.value)}
                style={{ border: '1px solid #cbd5e1', background: '#fff', color: '#172033', borderRadius: '8px', padding: '7px 10px', fontSize: '13px', fontWeight: 600, maxWidth: 220 }}
              >
                {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <span className={`status ${apiStatus === 'Connected' ? 'good' : 'bad'}`}>
              ● API {apiStatus}
            </span>
            <span className="muted" style={{ margin: 0 }}>
              Signed in as <b style={{ color: '#172033' }}>{user.name}</b>
            </span>
            <button
              type="button"
              onClick={onLogout}
              style={{ border: '1px solid #cbd5e1', background: '#fff', color: '#334155', borderRadius: '8px', padding: '7px 12px', fontSize: '12px', fontWeight: 650 }}
            >
              Log out
            </button>
          </div>
        </header>

        {section === 'admin' && user.role === 'admin' ? (
          <AdminAccounts currentUsername={user.username} />
        ) : section === 'admin' ? (
          <section className="panel empty"><h2>Access denied</h2><p className="muted">Administrator access is required to view accounts.</p></section>
        ) : section === 'buildings' ? (
          <Buildings
            buildings={buildings}
            selectedId={buildingId}
            onSelect={id => selectBuilding(id)}
            onGoToDatasets={() => setPage('Dataset Management')}
          />
        ) : section === 'dataset' ? (
          <DatasetUpload 
            onUploaded={loadDatasetFile} 
            onListChanged={() => { void loadBuildings() }}
            onDeleted={handleDatasetDeleted}
            currentFilename={filename} 
          />
        ) : section === 'overview' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <section className="panel" style={{ background: 'linear-gradient(135deg, #101B2D, #172A46)', color: '#FFFFFF', border: 'none', padding: '32px' }}>
              <span className="tag" style={{ background: '#2563EB', color: '#FFF', marginBottom: '12px', display: 'inline-block' }}>ENERGYPULSE 2.0 PLATFORM</span>
              <h2 style={{ color: '#FFFFFF', fontSize: '24px', fontWeight: 800, marginBottom: '12px' }}>Welcome to EnergyPulse 2.0</h2>
              <p style={{ color: '#94A3B8', fontSize: '15px', lineHeight: '1.6', maxWidth: '800px', margin: 0 }}>
                EnergyPulse 2.0 is an enterprise-grade energy monitoring and management SaaS platform engineered for commercial facilities, campuses, and industrial plants. It processes granular time-series data to optimize power distribution, forecast multi-year electricity trends, and mitigate high peak-load billing penalties.
              </p>
            </section>

            <div className="two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <section className="panel" style={{ borderTop: '4px solid #2563EB' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A', marginBottom: '8px' }}>🚀 Core Dashboard Modules</h3>
                <ul style={{ paddingLeft: '20px', color: '#475569', fontSize: '14px', lineHeight: '1.8', margin: 0 }}>
                  <li><b>Dataset Management:</b> Ingest, store, and switch between multi-gigabyte CSV datasets with automatic schema detection.</li>
                  <li><b>Energy Consumption:</b> Deep-dive into granular time-series graphs, monthly totals, and equipment sub-meter breakdowns.</li>
                  <li><b>Forecasting:</b> Project future electricity consumption using historical seasonal trends and regression models.</li>
                  <li><b>Peak-Load Analysis:</b> Identify peak power spikes and execute energy-saving action plans.</li>
                  <li><b>Reports &amp; Summary:</b> Export professional CSV breakdowns and print formatted PDF facility reports.</li>
                </ul>
              </section>

              <section className="panel" style={{ borderTop: '4px solid #10B981' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A', marginBottom: '8px' }}>📌 Quick Getting Started Guide</h3>
                <ol style={{ paddingLeft: '20px', color: '#475569', fontSize: '14px', lineHeight: '1.8', margin: 0 }}>
                  <li>Go to <b>Dataset Management</b> in the sidebar.</li>
                  <li>Upload your facility&apos;s CSV consumption file or select one from your repository table.</li>
                  <li>Once active, navigate to <b>Energy Consumption</b> to inspect metrics, charts, and appliance sub-meters.</li>
                  <li>Explore forecasting and peak-load modules to generate cost reduction strategies.</li>
                </ol>
              </section>
            </div>
          </div>
        ) : !filename || !d ? (
          <section className="panel empty">
            <div className="empty-icon">⚡</div>
            <h2>No dataset selected</h2>
            <p className="muted">Upload a CSV dataset to activate EnergyPulse 2.0 analytics.</p>
            {error && <p className="error" style={{ color: '#EF4444' }}>{error}</p>}
            <button onClick={() => setPage('Dataset Management')}>Upload CSV dataset</button>
          </section>
        ) : (
          <>
            {section === 'consumption' && (
              <>
                <section className="cards">
                  {cards.map(x => (
                    <article className={`stat ${x.c}`} key={x.label}>
                      <span>{x.label}</span>
                      <strong>{x.v}</strong>
                      <small>{x.desc}</small>
                    </article>
                  ))}
                </section>

                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Consumption over time</h2>
                      <p className="muted">Actual readings from the uploaded CSV file</p>
                    </div>
                    <span className="tag">{d.records} points</span>
                  </div>
                  <Chart data={d.series} />
                  <p className="explain">
                    This view displays actual energy use record by record. Investigate sustained rises and repeated peak loads for potential scheduling efficiencies.
                  </p>
                </section>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>Monthly / seasonal consumption</h2>
                        <p className="muted">Monthly totals based on timestamps</p>
                      </div>
                    </div>
                    {monthly.length ? (
                      <div
                        style={{
                          width: '100%',
                          overflowX: 'auto',
                          overflowY: 'hidden',
                          paddingBottom: '10px',
                          WebkitOverflowScrolling: 'touch'
                        }}
                      >
                        <div
                          className="bars"
                          style={{
                            height: '220px',
                            alignItems: 'flex-end',
                            paddingTop: '30px',
                            display: 'flex',
                            flexWrap: 'nowrap',
                            gap: '10px',
                            width: 'max-content',
                            minWidth: '100%'
                          }}
                        >
                        {monthly.map(m => (
                          <div className="bar-item" key={m.month} style={{ flex: '0 0 38px', width: '38px', minWidth: '38px', position: 'relative' }}>
                            <div
                              className="bar-value"
                              style={{
                                fontSize: '10px',
                                fontWeight: 600,
                                color: '#64748B',
                                marginBottom: '6px',
                                textAlign: 'center',
                                whiteSpace: 'nowrap'
                              }}
                              title={`${m.month}: ${num(m.kwh)} kWh`}
                            >
                              {(m.kwh / 1000).toFixed(0)}k
                            </div>
                            <div
                              className="bar"
                              style={{
                                width: '100%',
                                maxHeight: '140px',
                                height: `${Math.max(6, (m.kwh / Math.max(...monthly.map(x => x.kwh))) * 140)}px`,
                                background: 'linear-gradient(180deg, #10B981, #14B8A6)',
                                borderRadius: '6px 6px 0 0',
                                transition: 'all 0.2s'
                              }}
                              title={`${m.month}: ${num(m.kwh)} kWh`}
                            />
                            <small style={{ fontSize: '10px', color: '#64748B', marginTop: '6px', display: 'block', textAlign: 'center' }}>
                              {m.month.split(' ')[0]}
                            </small>
                          </div>
                        ))}
                        </div>
                      </div>
                    ) : (
                      <p className="muted">No recognizable date column detected for monthly breakdowns.</p>
                    )}
                    <p className="explain">
                      {monthly.length ? `Highest observed month: ${peakMonth.month} (${num(peakMonth.kwh)} kWh).` : ''}
                    </p>
                  </section>

                  <ApplianceInfluence appliances={d.appliances} ml={ml} loading={mlLoading} error={mlError} />
                </div>
              </>
            )}

            {section === 'forecast' && (
              <>
                <MlStatus loading={mlLoading} error={mlError} />
                {ml && <ForecastAlerts ml={ml} />}
                {ml && <ModelComparison ml={ml} />}
              </>
            )}

            {section === 'forecast' && (
              <SeasonalForecast
                history={d.monthly_history || []}
                forecast={d.forecast_2026 || []}
                regression={d.regression ?? null}
                rate={rate}
              />
            )}

            {section === 'planning' && (
              <>
                <section className="cards">
                  {cards.slice(1, 4).map(x => (
                    <article className={`stat ${x.c}`} key={x.label}>
                      <span>{x.label}</span>
                      <strong>{x.v}</strong>
                      <small>{x.desc}</small>
                    </article>
                  ))}
                </section>

                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Monthly Consumption &amp; Peak-Load Threshold</h2>
                      <p className="muted">Monthly totals; the hourly Peak-Load threshold is learned from your data (see classification below).</p>
                    </div>
                    <span className="tag" style={{ background: '#FEF2F2', color: '#DC2626' }} title="Calculated as the maximum recorded single-interval value in the time-series dataset: E_peak = max(e_1, e_2, ..., e_n)">
                      {ml ? `Peak-Load: above ${num(ml.classification.thresholds.high)} kWh/hour (P${ml.classification.thresholds.high_pct})` : `Highest recorded: ${num(d.peak_kwh)} kWh`}
                    </span>
                  </div>

                  {monthly.length ? (
                    <div className="bars" style={{ height: '200px', alignItems: 'flex-end', paddingTop: '20px', marginBottom: '20px' }}>
                      {monthly.map(m => {
                        const isPeakMonth = m.kwh === Math.max(...monthly.map(x => x.kwh))
                        return (
                          <div 
                            className="bar-item" 
                            key={m.month} 
                            style={{ flex: 1, minWidth: 0, position: 'relative', cursor: 'pointer' }}
                            title={`${m.month}: ${num(m.kwh)} kWh (${isPeakMonth ? 'Highest month' : 'Monthly total'})`}
                          >
                            <div 
                              className="bar-value" 
                              style={{ fontSize: '10px', fontWeight: 600, color: isPeakMonth ? '#DC2626' : '#64748B', marginBottom: '6px', textAlign: 'center' }}
                              title={`${m.month}: ${num(m.kwh)} kWh`}
                            >
                              {(m.kwh / 1000).toFixed(0)}k
                            </div>
                            <div
                              className="bar"
                              style={{
                                width: '100%',
                                maxHeight: '120px',
                                height: `${Math.max(6, (m.kwh / Math.max(...monthly.map(x => x.kwh))) * 120)}px`,
                                background: isPeakMonth ? 'linear-gradient(180deg, #EF4444, #DC2626)' : 'linear-gradient(180deg, #3B82F6, #1D4ED8)',
                                borderRadius: '6px 6px 0 0'
                              }}
                              title={`${m.month}: ${num(m.kwh)} kWh`}
                            />
                            <small style={{ fontSize: '10px', color: '#64748B', marginTop: '6px', display: 'block', textAlign: 'center' }}>
                              {m.month.split(' ')[0]}
                            </small>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748B', borderTop: '1px solid #E2E8F0', paddingTop: '8px' }}>
                    <span>🔵 Monthly total</span>
                    <span style={{ color: '#DC2626', fontWeight: 600 }}>🔴 Highest month</span>
                  </div>
                </section>

                <MlStatus loading={mlLoading} error={mlError} />
                {ml && <ClassificationPanel ml={ml} busy={mlLoading} onApplyThresholds={(low, high) => setCuts({ low, high })} />}

                <section className="panel" style={{ borderLeft: '4px solid #3B82F6' }}>
                  <h2>Energy-saving action plan</h2>
                  <p className="muted">Suggested priorities based on your measurements:</p>
                  <ol className="plan-list" style={{ paddingLeft: '20px', lineHeight: '1.7', color: 'var(--text-main)' }}>
                    <li><b>Peak control:</b> Review equipment schedules around highest recorded consumption ({num(d.peak_kwh)} kWh).</li>
                    <li><b>Baseline target:</b> Set a reduction target of 5% from average consumption ({num(d.average_kwh)} kWh/record); target baseline is <b>{num(d.average_kwh * 0.95)} kWh</b>.</li>
                    <li><b>Equipment review:</b> Prioritize heavy load equipment optimization.</li>
                  </ol>
                </section>
              </>
            )}

            {section === 'reports' && (
              <>
                {/* Print Control Header (Hidden during PDF print) */}
                <section className="panel no-print" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC', border: '1px solid #CBD5E1' }}>
                  <div>
                    <h2 style={{ color: '#0F172A', fontSize: '18px' }}>Download &amp; Print Facility Report</h2>
                    <p className="muted" style={{ margin: 0 }}>Export CSV analytics or generate a formatted PDF facility report.</p>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                      type="button"
                      style={{ background: '#2563EB', color: '#FFF', fontWeight: 700, padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                      onClick={() => {
                        try {
                          const lines = ['section,label,kwh,php']
                          monthly.forEach(m => lines.push(`historical,${m.month},${m.kwh},${(m.kwh * rate).toFixed(2)}`))
                          const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = 'energypulse-report.csv'
                          a.click()
                          URL.revokeObjectURL(url)
                        } catch {
                          alert('Error generating CSV download.')
                        }
                      }}
                    >
                      📥 Download CSV
                    </button>
                    <button
                      type="button"
                      style={{ background: '#10B981', color: '#FFF', fontWeight: 700, padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                      onClick={() => window.print()}
                    >
                      🖨️ Print / Save PDF
                    </button>
                  </div>
                </section>

                {/* Rate Configuration Card */}
                <section className="panel no-print">
                  <h2>Cost estimate &amp; Rate adjustment</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                      Electricity rate (₱/kWh)
                      <input
                        type="number"
                        min="0"
                        step=".01"
                        value={rate}
                        onChange={e => setRate(Math.max(0, Number(e.target.value) || 0))}
                      />
                    </label>
                  </div>
                  <p style={{ fontSize: '16px', fontWeight: 700, margin: '8px 0 0 0' }}>
                    Estimated Total Cost: <span style={{ color: 'var(--emerald)' }}>{money(d.total_kwh * rate)}</span>
                  </p>
                </section>

                {/* Executive Printable Summary Sheet */}
                <section className="panel print-summary" style={{ padding: '24px', background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '8px' }}>
                  <div style={{ borderBottom: '2px solid #0F172A', paddingBottom: '12px', marginBottom: '20px' }}>
                    <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#0F172A', margin: 0 }}>FACILITY ENERGY AUDIT & ANALYTICS SUMMARY</h2>
                    <p style={{ color: '#64748B', fontSize: '13px', margin: '4px 0 0 0' }}>
                      Generated by EnergyPulse 2.0 · Active File: <b>{d.filename}</b> ({d.dates.start} — {d.dates.end})
                    </p>
                  </div>

                  {/* Summary Metric Table */}
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1E293B', marginBottom: '8px' }}>1. Key Consumption Metrics</h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#F1F5F9', textAlign: 'left' }}>
                        <th style={{ padding: '8px', border: '1px solid #CBD5E1' }}>Metric Description</th>
                        <th style={{ padding: '8px', border: '1px solid #CBD5E1' }}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0' }}>Total Dataset Consumption</td>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0', fontWeight: 700 }}>{num(d.total_kwh)} kWh</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0' }}>Average Record Reading</td>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0', fontWeight: 700 }}>{num(d.average_kwh)} kWh</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0' }}>Peak Interval Demand</td>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0', fontWeight: 700, color: '#DC2626' }}>{num(d.peak_kwh)} kWh</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0' }}>Minimum Interval Baseline</td>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0', fontWeight: 700 }}>{num(d.minimum_kwh)} kWh</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0' }}>Electricity Billing Rate</td>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0' }}>₱{rate.toFixed(2)} / kWh</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0', fontWeight: 700 }}>Estimated Cumulative Cost</td>
                        <td style={{ padding: '8px', border: '1px solid #E2E8F0', fontWeight: 800, color: '#10B981' }}>{money(d.total_kwh * rate)}</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Appliance Breakdown Summary */}
                  {d.appliances.length > 0 && (
                    <>
                      <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1E293B', marginBottom: '8px' }}>2. Major Sub-Metering Distribution</h3>
                      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ background: '#F1F5F9', textAlign: 'left' }}>
                            <th style={{ padding: '8px', border: '1px solid #CBD5E1' }}>Equipment Category</th>
                            <th style={{ padding: '8px', border: '1px solid #CBD5E1' }}>Consumption (kWh)</th>
                            <th style={{ padding: '8px', border: '1px solid #CBD5E1' }}>Share of Peak Load</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.appliances.slice(0, 8).map(app => (
                            <tr key={app.name}>
                              <td style={{ padding: '8px', border: '1px solid #E2E8F0' }}>{app.name}</td>
                              <td style={{ padding: '8px', border: '1px solid #E2E8F0', fontWeight: 600 }}>{num(app.kwh)} kWh</td>
                              <td style={{ padding: '8px', border: '1px solid #E2E8F0' }}>
                                {((app.kwh / d.total_kwh) * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  {/* Executive Action Plan */}
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1E293B', marginBottom: '8px' }}>3. Peak Management Action Plan</h3>
                  <ul style={{ paddingLeft: '20px', fontSize: '13px', lineHeight: '1.6', color: '#334155', margin: 0 }}>
                    <li><b>Peak Shaving:</b> Restructure equipment runtime around recorded peak spikes ({num(d.peak_kwh)} kWh).</li>
                    <li><b>Baseline Reduction Target:</b> Maintain a 5% target decrease against average consumption (Target: <b>{num(d.average_kwh * 0.95)} kWh</b>).</li>
                  </ul>
                </section>
              </>
            )}
          </>
        )}

        <footer>
          EnergyPulse 2.0 · Professional Energy Analytics SaaS Platform
        </footer>
      </main>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState<boolean>(() => !!getToken())

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  // Restore the session on page load, and sign out automatically if the server rejects the token.
  useEffect(() => {
    setUnauthorizedHandler(logout)
    if (!getToken()) return
    authFetch(`${API}/api/auth/me`)
      .then(r => (r.ok ? r.json() : null))
      .then(u => { if (u) setUser(u) })
      .catch(() => {})
      .finally(() => setChecking(false))
    return () => setUnauthorizedHandler(null)
  }, [logout])

  if (checking) {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', color: '#64748b' }}>Loading…</div>
  }

  if (!user) {
    return <Login onLogin={(token, u) => { setToken(token); setUser(u) }} />
  }

  return <Dashboard user={user} onLogout={logout} />
}