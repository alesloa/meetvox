// Stops a release build when a bundled binary is missing, so an installer can never
// ship without whisper-cli or ffmpeg. Runs first in `npm run dist:mac` / `dist:win`.
//
//   node scripts/binaries/check.mjs mac|win

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const resources = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources')

const MAC = ['whisper-cli', 'ffmpeg', 'meetvox-syscap']
const REQUIRED = {
  mac: { 'mac-arm64': MAC, 'mac-x64': MAC },
  win: { 'win-x64': ['whisper-cli.exe', 'libwhisper.dll', 'ggml.dll', 'ggml-base.dll', 'ffmpeg.exe'] }
}

const platform = process.argv[2]
const dirs = REQUIRED[platform]
if (!dirs) {
  console.error('usage: node scripts/binaries/check.mjs mac|win')
  process.exit(1)
}

const missing = Object.entries(dirs).flatMap(([dir, files]) =>
  files.filter((f) => !existsSync(join(resources, dir, f))).map((f) => `resources/${dir}/${f}`)
)
// ggml loads one CPU backend DLL at runtime; at least one has to ship.
if (platform === 'win') {
  const win = join(resources, 'win-x64')
  const cpu = existsSync(win) && readdirSync(win).some((f) => /^ggml-cpu-.+\.dll$/.test(f))
  if (!cpu) missing.push('resources/win-x64/ggml-cpu-*.dll')
}
if (!existsSync(join(resources, 'licenses', 'THIRD_PARTY_NOTICES.md'))) {
  missing.push('resources/licenses/THIRD_PARTY_NOTICES.md')
}

if (missing.length > 0) {
  console.error(`Missing bundled files:\n  ${missing.join('\n  ')}`)
  console.error(`Run \`npm run binaries:${platform}\` first (see resources/README.md).`)
  process.exit(1)
}
console.log(`All bundled ${platform} binaries are present.`)
