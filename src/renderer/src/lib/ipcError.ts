// ipcRenderer.invoke rejects with "Error invoking remote method '<channel>': Error: <msg>".
// Main already writes <msg> for people, so show only that.
const INVOKE_PREFIX = /^Error invoking remote method '[^']*': (?:\w*Error: )?/

export function ipcErrorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.replace(INVOKE_PREFIX, '')
}
