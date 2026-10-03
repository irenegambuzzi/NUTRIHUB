import { useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { cn } from '../../lib/cn'

const GAP = 8 // px between rows (space-y-2)
const EDGE = 80 // px from the screen edge where dragging scrolls

// A list whose rows can be dragged by their handle (with a finger or the
// mouse) to any place. The handle also moves its row with the ↑ / ↓ keys.
// onMove(from, to) is called once, when the row is dropped.
export function SortableList({ items, getKey, renderItem, onMove, itemLabel }) {
  const [drag, setDrag] = useState(null) // { from, to, startY, dy, rects, scrollStart }
  const rows = useRef([])

  const start = (e, index) => {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDrag({
      from: index,
      to: index,
      startY: e.clientY,
      dy: 0,
      rects: rows.current.slice(0, items.length).map((el) => el?.getBoundingClientRect()),
      scrollStart: window.scrollY,
    })
  }

  const move = (e) => {
    if (!drag) return
    if (e.clientY < EDGE) window.scrollBy(0, -12)
    else if (e.clientY > window.innerHeight - EDGE) window.scrollBy(0, 12)
    const dy = e.clientY - drag.startY + (window.scrollY - drag.scrollStart)
    const own = drag.rects[drag.from]
    const center = own.top + own.height / 2 + dy
    // The new place: past the middle of a row means taking its place.
    let to = drag.from
    for (let i = 0; i < drag.from; i++) {
      const r = drag.rects[i]
      if (center < r.top + r.height / 2) {
        to = i
        break
      }
    }
    if (to === drag.from) {
      for (let i = drag.rects.length - 1; i > drag.from; i--) {
        const r = drag.rects[i]
        if (center > r.top + r.height / 2) {
          to = i
          break
        }
      }
    }
    setDrag((d) => ({ ...d, dy, to }))
  }

  const end = () => {
    if (drag && drag.to !== drag.from) onMove(drag.from, drag.to)
    setDrag(null)
  }

  // Rows between the old and new place make room for the dragged one.
  const offset = (index) => {
    if (!drag) return 0
    if (index === drag.from) return drag.dy
    const shift = drag.rects[drag.from].height + GAP
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -shift
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return shift
    return 0
  }

  return (
    <ul className="space-y-2 select-none">
      {items.map((item, index) => (
        <li
          key={getKey(item)}
          ref={(el) => (rows.current[index] = el)}
          style={{ transform: `translateY(${offset(index)}px)` }}
          className={cn(
            'flex items-center gap-2 rounded-2xl border bg-[var(--color-surface)] border-[var(--color-border)]',
            drag?.from === index ? 'relative z-10 shadow-xl border-[var(--color-primary)]' : drag ? 'transition-transform duration-150' : ''
          )}
        >
          <button
            type="button"
            aria-label={`Move ${itemLabel(item)} (drag, or use the arrow keys)`}
            onPointerDown={(e) => start(e, index)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' && index > 0) {
                e.preventDefault()
                onMove(index, index - 1)
              } else if (e.key === 'ArrowDown' && index < items.length - 1) {
                e.preventDefault()
                onMove(index, index + 1)
              }
            }}
            style={{ touchAction: 'none' }}
            className="self-stretch px-3 flex items-center text-[var(--color-icon-muted)] cursor-grab active:cursor-grabbing"
          >
            <GripVertical size={20} />
          </button>
          <div className="flex-1 min-w-0 py-3 pr-3">{renderItem(item, index)}</div>
        </li>
      ))}
    </ul>
  )
}
