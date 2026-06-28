interface PlaceholderViewProps {
  name: string
}

export function PlaceholderView({ name }: PlaceholderViewProps): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <p className="text-sm font-medium text-foreground">{name}</p>
      <p className="text-xs text-muted-foreground">Coming in a later phase</p>
    </div>
  )
}
