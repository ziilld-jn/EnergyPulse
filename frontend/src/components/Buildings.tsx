export type Building = {
  id: string
  dataset: string
  building: string
  name: string
  code: string
  type: string
  floors: number | null
  capacity_kw: number | null
  zone: string
  smart_meter: boolean | null
  records: number
  start: string | null
  end: string | null
  peak_kw: number | null
}

export default function Buildings({
  buildings, selectedId, onSelect, onGoToDatasets,
}: {
  buildings: Building[]
  selectedId: string
  onSelect: (id: string) => void
  onGoToDatasets: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Buildings</h2>
            <p className="muted">
              Buildings come from your CSV files. Upload a CSV in Dataset Management and every building in its
              <code> building_id </code> column is listed here. Pick one to see its own analytics and forecasts.
            </p>
          </div>
          <button type="button" className="secondary" onClick={onGoToDatasets}>Go to Dataset Management</button>
        </div>
      </section>

      {buildings.length === 0 ? (
        <section className="panel empty">
          <h2>No buildings yet</h2>
          <p className="muted">Upload a CSV with a building column (for example building_id) to see its buildings here.</p>
          <button type="button" onClick={onGoToDatasets}>Upload CSV dataset</button>
        </section>
      ) : (
        buildings.map(b => {
          const selected = b.id === selectedId
          const sub = [b.type, b.floors ? `${b.floors}F` : ''].filter(Boolean).join(' · ')
          return (
            <section key={b.id} className="panel" style={{ gap: 12, border: selected ? '2px solid #10B981' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {b.name}
                    {selected && <span style={{ fontSize: 11, fontWeight: 700, color: '#047857', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 999, padding: '2px 10px' }}>Selected</span>}
                  </h2>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {sub || b.code || 'Building'}{sub && b.code && b.code !== b.name ? ` · ${b.code}` : ''}
                  </p>
                </div>
                {b.capacity_kw ? (
                  <span style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                    {b.capacity_kw.toLocaleString()} kW capacity
                  </span>
                ) : b.peak_kw ? (
                  <span style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600 }} title="Highest demand found in the data">
                    {b.peak_kw.toLocaleString(undefined, { maximumFractionDigits: 0 })} kW peak demand
                  </span>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 14, color: '#334155' }}>
                {b.zone && <span>{b.zone}</span>}
                {b.smart_meter !== null && (
                  <span style={{ color: b.smart_meter ? '#047857' : '#94A3B8' }}>● {b.smart_meter ? 'Smart meter active' : 'No smart meter'}</span>
                )}
                <span>{b.records.toLocaleString()} records{b.start && b.end ? ` · ${b.start} to ${b.end}` : ''}</span>
                <span className="muted" style={{ margin: 0, fontSize: 13 }}>From <code>{b.dataset}</code></span>
              </div>
              <div>
                <button type="button" disabled={selected} onClick={() => onSelect(b.id)}>{selected ? 'Viewing' : 'View this building'}</button>
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}