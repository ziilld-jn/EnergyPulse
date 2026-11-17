import { useEffect, useRef } from 'react'

/** Which first item is visible for a given scroll position. */
export const startFromScroll = (scrollLeft: number, scrollWidth: number, total: number, size: number) =>
  Math.max(0, Math.min(total - size, Math.round((scrollLeft / Math.max(1, scrollWidth)) * total)))

/** Scroll position that shows a given first item. */
export const scrollFromStart = (start: number, scrollWidth: number, total: number) =>
  (start / Math.max(1, total)) * scrollWidth

/**
 * A real horizontal scroll bar for zoomed charts.
 * `total` = number of points, `size` = how many are visible, `start` = first visible index.
 * When the chart is not zoomed there is nothing to scroll, so only a hint is shown.
 */
export default function ScrollStrip({ total, size, start, onStart }: {
  total: number
  size: number
  start: number
  onStart: (start: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const zoomed = size < total

  // Keep the bar in step when the window moves some other way (Zoom buttons, day chips, Reset).
  useEffect(() => {
    const el = ref.current
    if (!el || !zoomed) return
    const want = scrollFromStart(start, el.scrollWidth, total)
    if (Math.abs(el.scrollLeft - want) > 1) el.scrollLeft = want
  }, [start, size, total, zoomed])

  if (!zoomed) {
    return <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Zoom in, then use the scroll bar that appears here to move left and right.</p>
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div
        ref={ref}
        tabIndex={0}
        aria-label="Scroll the chart left and right"
        onScroll={e => {
          const el = e.currentTarget
          const s = startFromScroll(el.scrollLeft, el.scrollWidth, total, size)
          if (s !== start) onStart(s)
        }}
        style={{ overflowX: 'auto', overflowY: 'hidden', background: '#F1F5F9', borderRadius: 8, border: '1px solid #E2E8F0' }}
      >
        <div style={{ width: `${(total / size) * 100}%`, height: 1 }} />
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>◀ Scroll left and right with the bar above (showing {size} of {total} points) ▶</p>
    </div>
  )
}