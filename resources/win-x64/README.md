# Windows (win-x64) binaries + setup

Drop two executables here. They are gitignored (acquired/built separately):

```
resources/win-x64/
├── whisper-cli.exe     # whisper.cpp CLI (+ any whisper.dll / ggml*.dll it ships with)
└── ffmpeg.exe          # static ffmpeg
```

There is **no** `meetvox-syscap` on Windows — system audio is captured through PortAudio,
not a helper.

## Fastest path (testing)

From the repo root, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-win.ps1 -FetchBinaries
```

That installs deps, rebuilds the native audio addon for Electron, and downloads
`whisper-cli.exe` (latest whisper.cpp release) + `ffmpeg.exe` (gyan.dev static) into this
folder. Drop `-FetchBinaries` to only check + print instructions.

> The prebuilt whisper.cpp release is **not** fully static — it ships `whisper.dll` /
> `ggml*.dll`. The script copies those next to `whisper-cli.exe` so it resolves them from
> its own directory; electron-builder bundles the whole `win-x64/` folder, so they ride
> along. For a dependency-free ship build, do a from-source static build (below).

## From source (ship build)

- **whisper-cli.exe** — build whisper.cpp with MSVC, static CRT (`/MT`), CPU-only:
  ```
  cmake -B build -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded
  cmake --build build --config Release
  ```
  Copy `build\bin\Release\whisper-cli.exe` here. The pipeline relies on the `-nt` flag
  (see `src/main/transcribe/whisper.ts`).
- **ffmpeg.exe** — static build per the configure in the top-level `resources/README.md`
  (covers `channelsplit`/`volumedetect` for recording + the import demuxers/decoders).

## System audio on Windows — how it works

The System Audio dropdown lists, in order:

1. **Virtual-cable inputs** — `CABLE Output (VB-Audio Virtual Cable)`, VoiceMeeter outputs.
   These are real PortAudio **input** devices (the Windows analogue of BlackHole) and are
   captured directly and reliably. **This is the recommended path.**
   - Install [VB-Cable](https://vb-audio.com/Cable/), set **CABLE Input** as the Windows
     default **output**, and pick **CABLE Output (VB-Audio)** as System Audio in the app.
     (To still hear audio, use a "Listen to this device" monitor or VoiceMeeter.)
2. **WASAPI render endpoints** — your actual speakers/headphones, captured via WASAPI
   loopback.

> **Known caveat:** `naudiodon2` does not expose PortAudio's `paWinWasapiLoopback` flag,
> so opening a render endpoint as an input (option 2) may not capture on all builds. If the
> System meter stays flat for a render endpoint, use the VB-Cable input (option 1) instead.
> A render-endpoint that can't loopback fails soft (the meter just stays flat).

Mic = left channel = "You"; System = right channel = "Other" — unchanged from macOS.

## After setup

```
npm run dev                       # run
npx electron-builder --win nsis   # installer (not one-click; lets the user pick the dir)
```

The 1 GB Whisper model (`ggml-large-v3-q5_0.bin`) is **not** bundled — it auto-downloads on
first transcribe to `%USERPROFILE%\.meetvox\models\`. whisper-cli.exe is CPU-only on
Windows (no Metal), so transcription is slower than on Apple Silicon but works.
```
