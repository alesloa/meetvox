# Bundled native binaries

The app spawns three native binaries at runtime, resolved by
`src/main/binaries/resolve.ts`. They are **not** checked into git (too large) and
are bundled into the packaged app via `electron-builder` `extraResources`.

Drop the correct builds here before `npm run dist:*`:

```
resources/
├── mac-arm64/
│   ├── whisper-cli        # whisper.cpp, Metal build (Apple Silicon)
│   ├── ffmpeg             # static ffmpeg, arm64
│   └── meetvox-syscap     # built by native/meetvox-syscap/build.sh
├── mac-x64/
│   ├── whisper-cli        # whisper.cpp, Metal build (Intel)
│   ├── ffmpeg             # static ffmpeg, x64
│   └── meetvox-syscap
└── win-x64/
    ├── whisper-cli.exe    # whisper.cpp, CPU-only, statically linked
    └── ffmpeg.exe         # static ffmpeg
```

## How to obtain each

### whisper-cli (whisper.cpp)
```bash
git clone https://github.com/ggerganov/whisper.cpp && cd whisper.cpp
# macOS (Metal is default on Apple platforms):
cmake -B build -DWHISPER_METAL=ON && cmake --build build -j --config Release
cp build/bin/whisper-cli /path/to/meetvox/resources/mac-arm64/whisper-cli
# Windows (CPU-only static): build with MSVC, static CRT (/MT), then copy whisper-cli.exe
```
The CLI flag the pipeline relies on is `-nt` (no timestamps); see
`src/main/transcribe/whisper.ts`. Confirm output parity against an existing
`recordings/meeting_*` folder (spec validation step 4).

### ffmpeg (static, built from source)
Build a static ffmpeg per target with `--disable-autodetect` so NO homebrew/system
libs leak into the binary. The configure below covers both the recording/transcription
path (wav/pcm + `channelsplit`/`volumedetect`) AND audio import (Phase 7) — the import
demuxers/decoders are ffmpeg's own native implementations, so no `libmp3lame`/`libvorbis`/
`libopus` are needed and `--disable-autodetect` still holds.

```
./configure --disable-everything --disable-autodetect --disable-network \
  --disable-doc --disable-programs --enable-ffmpeg --disable-x86asm --disable-asm \
  --enable-protocol=file \
  --enable-demuxer=wav,mov,matroska,ogg,mp3,flac,aiff,asf \
  --enable-muxer=wav,null \
  --enable-decoder=pcm_s16le,pcm_f32le,pcm_s24le,pcm_s32le,pcm_u8,pcm_s16be,aac,mp3,flac,vorbis,opus,alac \
  --enable-encoder=pcm_s16le \
  --enable-filter=channelsplit,channelmap,volumedetect,aresample,aformat,anull \
  --enable-static --disable-shared --enable-small
# mac-x64 cross build on Apple Silicon: add --enable-cross-compile --arch=x86_64
```

Build once per target into `resources/mac-arm64/`, `resources/mac-x64/`, `resources/win-x64/`.
**win-x64 ffmpeg.exe is not built yet** — it needs a Windows toolchain (pre-existing gap).

Verify the import decode path before shipping:
```bash
./ffmpeg -y -i sample.mp3 -ac 1 -ar 16000 -c:a pcm_s16le out.wav   # also try an .mp4
```
A 16 kHz mono `pcm_s16le` `out.wav` means import works; an "Unknown format" / "Decoder
not found" error means a demuxer/decoder is missing from the configure. Until this bigger
build replaces the minimal one, single-file import only decodes WAV.

### meetvox-syscap (macOS only)
```bash
bash native/meetvox-syscap/build.sh   # builds arm64 + x64 into resources/mac-*/
```
Then codesign + notarize (Gatekeeper blocks unsigned helpers):
```bash
codesign --force --options runtime --sign "Developer ID Application: …" \
  resources/mac-*/meetvox-syscap
```

## The Whisper model is NOT here
`ggml-large-v3-q5_0.bin` (1.08 GB) is downloaded on first transcribe to
`~/.meetvox/models/` by `src/main/models/download.ts`, not bundled.
