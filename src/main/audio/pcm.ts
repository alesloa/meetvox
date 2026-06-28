// Convert a PortAudio / syscap PCM buffer (interleaved 32-bit float, native LE on
// all target platforms) into a Float32Array. Handles odd-length tails defensively.

export function pcmFloat32(buf: Buffer): Float32Array {
  const usableBytes = buf.length - (buf.length % 4)
  const out = new Float32Array(usableBytes / 4)
  for (let i = 0; i < out.length; i++) {
    out[i] = buf.readFloatLE(i * 4)
  }
  return out
}
