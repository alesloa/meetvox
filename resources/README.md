# Bundled native binaries

The app spawns these binaries at runtime, resolved by `src/main/binaries/resolve.ts`.
They are **not** checked into git. `electron-builder` bundles them into the packaged app
through `extraResources`, together with `resources/licenses/`.

```
resources/
├── mac-arm64/
│   ├── whisper-cli        # whisper.cpp, static, Metal (Apple silicon)
│   ├── ffmpeg             # FFmpeg, LGPL, minimal
│   └── meetvox-syscap     # built from native/meetvox-syscap
├── mac-x64/               # the same three, for Intel Macs
├── win-x64/
│   ├── whisper-cli.exe    # whisper.cpp, mingw-w64, CPU only
│   ├── libwhisper.dll, ggml.dll, ggml-base.dll, ggml-cpu-*.dll
│   └── ffmpeg.exe         # FFmpeg, LGPL, minimal
└── licenses/              # committed: notices + license texts, shipped in the app
```

## Build them

Every binary builds from a pinned upstream source. The version, commit, and SHA-256 are
at the top of each script in `scripts/binaries/`.

```bash
npm run binaries:mac   # macOS: both Mac folders (needs Xcode tools, cmake, git)
npm run binaries:win   # macOS, Linux or WSL: win-x64 (needs mingw-w64 or Docker)
```

`npm run dist:mac` / `dist:win` run `scripts/binaries/check.mjs` first and stop if a
file is missing, so an installer can't ship without whisper-cli or ffmpeg.

### whisper-cli (whisper.cpp v1.9.5): `scripts/binaries/whisper.sh`

- **macOS:** one static binary with the Metal shaders built in. It runs on macOS 13.3+,
  the floor whisper.cpp's own `build-xcframework.sh` uses. Built with `GGML_NATIVE=OFF`,
  so it runs on every Apple silicon chip, not just the one that built it.
- **Windows:** cross-compiled with mingw-w64 (GCC). ggml loads the fastest
  `ggml-cpu-*.dll` the processor supports at runtime, so one build runs on any x64 PC.
  GCC's runtime is linked in, so it needs **no Visual C++ redistributable** (the official
  whisper.cpp Windows zip does). A UTF-8 manifest lets it open files under a user
  folder with non-ASCII letters, like `C:\Users\José`.

The pipeline relies on the `-nt` flag (see `src/main/transcribe/whisper.ts`).

### ffmpeg (FFmpeg 7.1.5): `scripts/binaries/ffmpeg.sh`

A minimal build with `--disable-everything` plus only what Meetvox runs: WAV in and out,
`channelsplit` / `volumedetect` for recordings, and the demuxers and decoders the Import
dialog offers (mp3, m4a/mp4, flac, ogg, opus, webm/mkv, wma, aiff). There is no
`--enable-gpl` or `--enable-nonfree`, so it stays LGPL-2.1-or-later.

Check the import path after a rebuild:

```bash
resources/mac-arm64/ffmpeg -y -i sample.mp3 -ac 1 -ar 16000 -c:a pcm_s16le out.wav
```

### meetvox-syscap (macOS only)

```bash
npm run pack:syscap   # builds arm64 + x64 into resources/mac-*/
```

Then codesign + notarize (Gatekeeper blocks unsigned helpers):

```bash
codesign --force --options runtime --sign "Developer ID Application: …" \
  resources/mac-*/meetvox-syscap
```

## Licenses

`licenses/THIRD_PARTY_NOTICES.md` lists each bundled program, its license, and its exact
source. When you publish a release, also attach `ffmpeg-7.1.5.tar.xz` (the source named
there) to it, so the LGPL source sits next to the binary.

## The Whisper model is NOT here

The model the user picks in Settings → Transcription downloads on first transcribe to
`~/.meetvox/models/` (`%USERPROFILE%\.meetvox\models\` on Windows), checked against the
size and SHA-256 in `src/shared/transcription.ts`.
