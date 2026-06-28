import type { ReactNode } from 'react'

interface CardProps {
  title?: string
  icon?: ReactNode
  children: ReactNode
  className?: string
}

export function Card({ title, icon, children, className = '' }: CardProps): JSX.Element {
  return (
    <section
      className={`no-drag rounded-xl border border-border bg-card p-4 shadow-sm ${className}`}
    >
      {title && (
        <header className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
          {icon}
          {title}
        </header>
      )}
      {children}
    </section>
  )
}
