// Reusable settings-page primitives (theme tokens only).

export function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
