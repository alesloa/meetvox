import { GAIN_MAX, GAIN_MIN, GAIN_STEP } from '@shared/constants'

interface GainSliderProps {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}

// Gain 0–3, step 0.1 (ported from the Python tk.Scale).
export function GainSlider({ value, onChange, disabled }: GainSliderProps): JSX.Element {
  return (
    <div className="flex w-28 shrink-0 items-center gap-2">
      <input
        type="range"
        min={GAIN_MIN}
        max={GAIN_MAX}
        step={GAIN_STEP}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="min-w-0 flex-1"
        aria-label="Gain"
      />
      <span className="w-7 text-right font-mono text-xs tabular-nums text-zinc-500">
        {value.toFixed(1)}
      </span>
    </div>
  )
}
