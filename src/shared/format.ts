// Tiny formatting helpers shared by main and renderer.

/** Zero-pad a number to two digits. */
export const pad2 = (n: number): string => String(n).padStart(2, '0')

/** seconds -> "HH:MM:SS" (truncating, like Python int()). */
export function hms(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}
