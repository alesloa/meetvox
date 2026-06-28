/**
 * Resolve the initial mic / system-audio selection with a deterministic precedence:
 *
 *   explicit in-session pick (cur)  >  saved default  >  auto-selected device
 *
 * `??` (not `||`) so a real device id of `0` and the macOS built-in-tap sentinel `-1`
 * are honoured rather than treated as "unset". `undefined` covers settings not yet
 * loaded (or failed to load) — it falls through to auto-select.
 */
export function resolveDeviceSelection(
  cur: number | null,
  savedDefault: number | null | undefined,
  auto: number | null
): number | null {
  return cur ?? savedDefault ?? auto
}
