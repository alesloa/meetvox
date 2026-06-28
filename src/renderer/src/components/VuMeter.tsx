import { useEffect, useRef, useState } from 'react'
import { VU_GREEN_BELOW, VU_YELLOW_BELOW } from '@shared/constants'

// Faithful port of recorder_blackhole.py::VUMeter: a horizontal level bar colored
// green / yellow / red at the ported thresholds (0.6 / 0.85, from constants), with a
// white peak-hold marker that holds ~30 frames then decays at 0.95/frame. Colors are
// the script's exact hex values (#4ade80 / #facc15 / #ef4444) via the `vu-*` tokens.

interface VuMeterProps {
  level: number // 0..1
}

const PEAK_HOLD_FRAMES = 30
const PEAK_DECAY = 0.95

function colorFor(level: number): string {
  if (level < VU_GREEN_BELOW) return 'bg-vu-green'
  if (level < VU_YELLOW_BELOW) return 'bg-vu-yellow'
  return 'bg-vu-red'
}

export function VuMeter({ level }: VuMeterProps): JSX.Element {
  const [peak, setPeak] = useState(0)
  const holdRef = useRef(0)
  const peakRef = useRef(0)

  useEffect(() => {
    const clamped = Math.max(0, Math.min(1, level))
    if (clamped > peakRef.current) {
      peakRef.current = clamped
      holdRef.current = PEAK_HOLD_FRAMES
    } else if (holdRef.current > 0) {
      holdRef.current -= 1
    } else {
      peakRef.current *= PEAK_DECAY
    }
    setPeak(peakRef.current)
  }, [level])

  const clamped = Math.max(0, Math.min(1, level))
  const pct = clamped * 100
  const peakPct = peak * 100

  return (
    <div className="relative h-4 min-w-0 flex-1 overflow-hidden rounded-md bg-black/60 ring-1 ring-inset ring-white/5">
      {/* No width transition: Python's draw_meter redraws the bar instantly every
          50ms. A CSS transition fights the 20Hz level updates — each ease-out
          restarts before finishing, so the bar smears and stalls ("blinks then
          freezes") while the transition-less peak marker below tracks tightly.
          Snap the bar to match Python. Do NOT re-add a width transition. */}
      <div className={`h-full rounded-md ${colorFor(clamped)}`} style={{ width: `${pct}%` }} />
      {peakPct > 1 && (
        <div
          className="absolute inset-y-0 w-[2px] bg-white/90"
          style={{ left: `calc(${Math.min(100, peakPct)}% - 1px)` }}
        />
      )}
    </div>
  )
}
