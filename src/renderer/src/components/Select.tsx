import type { AudioDevice } from '@shared/types'

interface SelectProps {
  label: string
  devices: AudioDevice[]
  value: number | null
  onChange: (id: number) => void
  disabled?: boolean
  hint?: string
}

export function Select({
  label,
  devices,
  value,
  onChange,
  disabled,
  hint
}: SelectProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-medium text-zinc-300">{label}</label>
      <div className="relative">
        <select
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full appearance-none rounded-lg border border-border bg-input px-3 py-2 pr-8 text-sm text-foreground outline-none transition focus:border-ring disabled:opacity-50"
        >
          {devices.length === 0 && <option value="">No devices found</option>}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  )
}
