// Every value here is ported verbatim from the two Python scripts. No invented
// numbers. If a value is missing, find it in the source — never approximate.

// --- recorder_blackhole.py ---
export const SAMPLE_RATE = 44100 // self.sample_rate
export const DEFAULT_INTERVAL_SEC = 30 // interval_var default "30"
export const GAIN_MIN = 0
export const GAIN_MAX = 3
export const GAIN_STEP = 0.1
export const GAIN_DEFAULT = 1.0
export const NORMALIZE_PEAK = 0.9 // audio / max_val * 0.9
export const INT16_SCALE = 32767 // (audio * 32767).astype(int16)
export const LEVEL_MULTIPLIER = 3 // min(1.0, peak * gain * 3)
export const MIC_CHANNELS = 1
export const SYSTEM_CHANNELS = 2
export const LEVELS_INTERVAL_MS = 50 // root.after(50, update_vu_meters)
export const AUTO_SAVE_POLL_MS = 10000 // root.after(10000, check_auto_save)

// VU meter color thresholds (VUMeter.draw_meter)
export const VU_GREEN_BELOW = 0.6
export const VU_YELLOW_BELOW = 0.85

// Virtual/loopback device name fragments excluded from the mic list and offered as
// system-audio capture sources. 'blackhole'/'soundflower'/'loopback' are macOS virtual
// cables; 'vb-audio'/'voicemeeter' are the Windows ones (VB-Cable, VoiceMeeter) — both
// expose a capture INPUT that mirrors the output, captured exactly like BlackHole.
export const LOOPBACK_NAME_FRAGMENTS = [
  'blackhole',
  'soundflower',
  'loopback',
  'vb-audio',
  'voicemeeter',
  'stereo mix'
] as const

// Synthetic id for the macOS "System Audio (built-in)" entry — the ScreenCaptureKit
// whole-mix fallback, which is NOT a PortAudio device. Real loopback inputs (BlackHole)
// carry their actual PortAudio id (>= 0); only this synthetic entry uses -1. Shared so
// main (capture routing) and renderer (pre-record meter gating) agree on the sentinel.
export const MAC_SYSTEM_AUDIO_ID = -1

// --- transcribe_meeting.py ---
export const WHISPER_INPUT_RATE = 16000 // -ar 16000
export const SILENCE_THRESHOLD_DB = -50 // silence_threshold
export const SILENCE_DEFAULT_DB = -100 // get_audio_level fallback
export const MERGE_WINDOW_SEC = 35 // merge_consecutive_speakers
export const SPEAKER_LEFT = 'You' // speaker1 (left channel = mic)
export const SPEAKER_RIGHT = 'Other' // speaker2 (right channel = system)
// Single-track imports have NO channel mapping (no mic/system split), so the one
// transcript line uses a neutral label — never You/Other (which assert a mapping
// that doesn't exist for an imported single file).
export const SPEAKER_NEUTRAL = 'Speaker'
export const BLANK_MARKERS = ['[BLANK_AUDIO]', '[ Silence ]', '[silence]', '(silence)'] as const

// --- model ---
export const MODEL_FILENAME = 'ggml-large-v3-q5_0.bin'
export const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin'
// Expected size in bytes (1.08 GB). Used for the progress bar + a sanity check.
// SHA verification is wired in models/download.ts once the canonical hash is pinned.
export const MODEL_EXPECTED_BYTES = 1_080_000_000
