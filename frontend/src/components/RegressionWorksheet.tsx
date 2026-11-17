import type { Regression } from './SeasonalForecast'

const n1 = (n: number) => n.toLocaleString('en-PH', { maximumFractionDigits: 1 })
const th: React.CSSProperties = {
  position: 'sticky', top: 0, background: '#F8FAFC', padding: '12px 14px',
  textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#334155', borderBottom: '1px solid #E2E8F0',
}
const td: React.CSSProperties = {
  padding: '12px 14px', textAlign: 'right', fontSize: 13, color: '#334155', borderBottom: '1px solid #F1F5F9',
}

export default function RegressionWorksheet({ regression }: { regression: Regression | null | undefined }) {
  if (!regression) return null
  const r = regression
  return (
    <section className="panel" style={{ borderTop: '4px solid #8B5CF6' }}>
      <span className="tag" style={{ background: '#EFF6FF', color: '#1D4ED8', fontWeight: 700, letterSpacing: 0.3 }}>
        MODULE 4 · ACADEMIC COMPUTATION WORKSHEET
      </span>
      <h2 style={{ fontSize: 24, fontWeight: 800, margin: '14px 0 4px' }}>Linear regression (class method) — all monthly points</h2>
      <p className="muted">
        y = dependent variable (kWh) · x = independent variable (month index) · a = intercept · b = slope. Computed using all monthly totals.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 28px', background: '#F1F5F9', borderRadius: 12, padding: '16px 20px', margin: '14px 0', fontSize: 15 }}>
        <span>n: <b>{r.n}</b></span>
        <span>x̄: <b>{n1(r.x_mean)}</b></span>
        <span>ȳ: <b>{n1(r.y_mean)}</b></span>
        <span>Slope b: <b style={{ color: '#2563EB' }}>{n1(r.b)}</b></span>
        <span>Intercept a: <b style={{ color: '#2563EB' }}>{n1(r.a)}</b></span>
        <span>R²: <b style={{ color: '#10B981' }}>{r.r2.toFixed(3)}</b></span>
      </div>

      <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12, padding: '16px 20px', fontFamily: 'monospace', fontSize: 14, color: '#1E3A8A', lineHeight: 1.9 }}>
        <b>Formulas &amp; Computed Values:</b>
        <div>b = Σ(x − x̄)(y − ȳ) / Σ(x − x̄)² = <b>{n1(r.b)}</b></div>
        <div>a = ȳ − b · x̄ = <b>{n1(r.a)}</b></div>
        <div>Predicted y = a + b · x</div>
      </div>

      <div style={{ maxHeight: 460, overflow: 'auto', marginTop: 18, border: '1px solid #E2E8F0', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Month</th><th style={th}>x</th><th style={th}>y</th>
              <th style={th}>x−x̄</th><th style={th}>y−ȳ</th>
              <th style={th}>(x−x̄)(y−ȳ)</th><th style={th}>(x−x̄)²</th>
              <th style={{ ...th, color: '#0F172A' }}>Predicted y</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map(row => (
              <tr key={row.label}>
                <td style={{ ...td, fontWeight: 600 }}>{row.label}</td>
                <td style={td}>{row.x}</td>
                <td style={td}>{n1(row.y)}</td>
                <td style={td}>{n1(row.dx)}</td>
                <td style={td}>{n1(row.dy)}</td>
                <td style={td}>{n1(row.product)}</td>
                <td style={td}>{n1(row.square)}</td>
                <td style={{ ...td, color: '#2563EB', fontWeight: 700 }}>{n1(row.predicted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 14, padding: '12px 16px', background: '#F8FAFC', borderLeft: '3px solid #CBD5E1', borderRadius: 4 }}>
        {r.note} A straight line cannot capture distinct seasonal peaks, so use the seasonal forecast and the machine-learning
        model above for operational planning, and use this table for academic coursework requirements.
      </p>
    </section>
  )
}