# Windows (win-x64) binaries + setup

These files live here. They are gitignored and built from pinned sources:

```
resources/win-x64/
├── whisper-cli.exe     # whisper.cpp v1.9.5, mingw-w64, CPU only
├── libwhisper.dll, ggml.dll, ggml-base.dll, ggml-cpu-*.dll
└── ffmpeg.exe          # FFmpeg 7.1.5, LGPL, minimal
```

There is **no** `meetvox-syscap` on Windows — system audio is captured through PortAudio,
not a helper.

## Build them

On a Mac or Linux machine (uses Docker when mingw-w64 isn't installed):

```bash
npm run binaries:win
```

On Windows, from the repo root in PowerShell, through WSL:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-win.ps1 -BuildBinaries
```

Both run `scripts/binaries/build.sh win`. The files need no Visual C++ redistributable:
GCC's runtime is linked in. ggml picks the fastest `ggml-cpu-*.dll` for the processor at
runtime. See `resources/README.md` for what each build includes.

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
npm run dist:win                  # installer (not one-click; lets the user pick the dir)
```

The Whisper model is **not** bundled. The one picked in Settings → Transcription
(default `ggml-large-v3-turbo-q5_0.bin`, about 574 MB) downloads on first transcribe to
`%USERPROFILE%\.meetvox\models\`. whisper-cli.exe is CPU-only on Windows (no Metal), so
transcription is slower than on Apple Silicon; Turbo is the practical model here.
```
