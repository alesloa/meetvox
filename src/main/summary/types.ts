// Re-export summary-related types from the shared type surface.
// Consumers inside the summary engine import from here; adding summary-internal
// types here in later phases keeps the import paths stable.
export type { ProviderKind, ProviderConfig, SummaryConfig, Summary } from '@shared/types'
