// Per-stream frame buffer. Mirrors recorder_blackhole.py: mic_data / system_data
// accumulate gained frames; save_chunk concatenates and clears. Frames are stored
// already-gained (the recorder applies gain before pushing).

function concat(frames: Float32Array[]): Float32Array | null {
  if (frames.length === 0) return null
  let total = 0
  for (const f of frames) total += f.length
  const out = new Float32Array(total)
  let off = 0
  for (const f of frames) {
    out.set(f, off)
    off += f.length
  }
  return out
}

export interface FlushedChunk {
  /** Concatenated mono mic samples, or null if none. */
  mic: Float32Array | null
  /** Concatenated interleaved system samples, or null if none. */
  system: Float32Array | null
  systemChannels: number
}

export class ChunkAccumulator {
  private micFrames: Float32Array[] = []
  private systemFrames: Float32Array[] = []

  constructor(private readonly systemChannels: number) {}

  pushMic(frame: Float32Array): void {
    this.micFrames.push(frame)
  }

  pushSystem(frame: Float32Array): void {
    this.systemFrames.push(frame)
  }

  hasData(): boolean {
    return this.micFrames.length > 0 || this.systemFrames.length > 0
  }

  /** Concatenate buffered frames and clear (matches save_chunk's copy-then-clear). */
  flush(): FlushedChunk {
    const mic = concat(this.micFrames)
    const system = concat(this.systemFrames)
    this.micFrames = []
    this.systemFrames = []
    return { mic, system, systemChannels: this.systemChannels }
  }
}
