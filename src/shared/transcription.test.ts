import { describe, it, expect } from 'vitest'
import { DEFAULT_LOCAL_MODEL, LEGACY_LOCAL_MODEL, LOCAL_MODELS, findLocalModel } from './transcription'

describe('LOCAL_MODELS — the on-device catalog', () => {
  it('lists the default first, so the recommended pick is at the top', () => {
    expect(LOCAL_MODELS[0].file).toBe(DEFAULT_LOCAL_MODEL)
  })

  it('still offers the old default, so upgraded installs keep working', () => {
    expect(findLocalModel(LEGACY_LOCAL_MODEL)).toBeDefined()
  })

  it('ends with full Large v3, the strongest model', () => {
    // Size + LFS oid from https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main
    expect(LOCAL_MODELS[LOCAL_MODELS.length - 1]).toMatchObject({
      file: 'ggml-large-v3.bin',
      bytes: 3_095_033_483,
      sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2'
    })
  })
})
