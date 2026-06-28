import { describe, it, expect } from 'vitest'
import { buildSplitArgs } from './splitChannels'

describe('buildSplitArgs — exact ffmpeg invocation from split_stereo_to_mono', () => {
  it('produces channelsplit args mapping left/right to 16k mono pcm_s16le', () => {
    expect(buildSplitArgs('/in/chunk_001.wav', '/tmp/left.wav', '/tmp/right.wav')).toEqual([
      '-y',
      '-i',
      '/in/chunk_001.wav',
      '-filter_complex',
      '[0:a]channelsplit=channel_layout=stereo[left][right]',
      '-map',
      '[left]',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '/tmp/left.wav',
      '-map',
      '[right]',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '/tmp/right.wav'
    ])
  })
})
