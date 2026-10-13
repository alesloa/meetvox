# Third-party software in Meetvox

Meetvox itself is MIT licensed (see `LICENSE` in the source repository,
https://github.com/alesloa/meetvox). The app bundles the programs below. Each one runs
as its own process; Meetvox starts it and reads its output, and does not link to it.
`scripts/binaries/` in the repository rebuilds every one of them from the source named here.

## whisper.cpp v1.9.5

Files: `whisper-cli` (macOS); `whisper-cli.exe`, `libwhisper.dll`, `ggml.dll`,
`ggml-base.dll`, `ggml-cpu-*.dll` (Windows).

- License: MIT. Full text: `whisper.cpp-MIT.txt`. Copyright (c) 2023-2026 The ggml authors.
- Source: https://github.com/ggml-org/whisper.cpp/tree/v1.9.5
  (commit d1be6fde11ac6e0407606b4e42fe72d34add8037).
- Build script: `scripts/binaries/whisper.sh`.

## FFmpeg 7.1.5

Files: `ffmpeg` (macOS), `ffmpeg.exe` (Windows).

- License: GNU Lesser General Public License, version 2.1 or later. Full text:
  `FFmpeg-LGPL-2.1.txt`. Built without `--enable-gpl` and without `--enable-nonfree`.
- Source: https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz
  (SHA-256 de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f).
- Configure flags and build steps: `scripts/binaries/ffmpeg.sh`.
- FFmpeg is a separate program inside the app. You may build your own version from
  this source and replace the bundled `ffmpeg` file with it.

## mingw-w64 12.0.0 runtime (Windows files only)

The Windows files above are compiled with mingw-w64 (GCC 14.2), which links parts of
its runtime into them.

- winpthreads: MIT-style license. Full text: `mingw-w64-winpthreads.txt`.
- mingw-w64 runtime: full text in `mingw-w64-runtime.txt`.
- GCC's libgcc and libstdc++ are linked under the GCC Runtime Library Exception, which
  puts no conditions on the compiled program.
- Source: https://github.com/mingw-w64/mingw-w64/tree/v12.0.0

## Whisper models (downloaded, not bundled)

On first use, Meetvox downloads the model you pick from
https://huggingface.co/ggerganov/whisper.cpp. OpenAI released the Whisper code and
model weights under the MIT License (https://github.com/openai/whisper/blob/main/LICENSE).
