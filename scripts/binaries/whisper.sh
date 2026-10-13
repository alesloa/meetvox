#!/usr/bin/env bash
# Build whisper-cli from the pinned whisper.cpp release.
#
#   bash scripts/binaries/whisper.sh mac-arm64|mac-x64|win-x64
#
# Output: resources/<target>/, or $OUT when set.
#
# mac-*:   one static binary with Metal (GPU) shaders built in. Runs on macOS 13.3+,
#          the floor whisper.cpp's own build-xcframework.sh uses (MACOS_MIN_OS_VERSION).
# win-x64: whisper-cli.exe plus whisper/ggml DLLs, cross-compiled with mingw-w64 (GCC).
#          CPU only. ggml picks the fastest ggml-cpu-*.dll the processor supports at
#          runtime, so one build runs on any x64 PC. GCC's runtime is linked in, so it
#          needs no Visual C++ redistributable. build.sh runs this inside Docker when
#          mingw-w64 isn't installed.
set -euo pipefail

VERSION=v1.9.5
COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037
MACOS_MIN=13.3

TARGET=${1:?usage: whisper.sh mac-arm64|mac-x64|win-x64}
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT=${OUT:-$ROOT/resources/$TARGET}
WORK="$(mktemp -d "${TMPDIR:-/tmp}/meetvox-whisper-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo "==> whisper.cpp $VERSION for $TARGET"
git clone --quiet --depth 1 --branch "$VERSION" https://github.com/ggml-org/whisper.cpp "$WORK/src" 2>/dev/null
got="$(git -C "$WORK/src" rev-parse HEAD)"
if [ "$got" != "$COMMIT" ]; then
  echo "whisper.cpp $VERSION is commit $got, expected $COMMIT" >&2
  exit 1
fi

config=(-S "$WORK/src" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF
  # Portable: never tune for the build machine's own CPU.
  -DGGML_NATIVE=OFF)

case "$TARGET" in
  mac-arm64 | mac-x64)
    arch=arm64
    [ "$TARGET" = mac-x64 ] && arch=x86_64
    config+=(-DBUILD_SHARED_LIBS=OFF -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON
      -DCMAKE_OSX_ARCHITECTURES="$arch" -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN")
    files=(whisper-cli)
    ;;
  win-x64)
    # Windows passes command-line arguments in the system code page unless the exe
    # asks for UTF-8. whisper.cpp opens the audio path as UTF-8, so without this a
    # user folder like C:\Users\José can't be read.
    cat >"$WORK/utf8.manifest" <<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>
    </windowsSettings>
  </application>
</assembly>
XML
    printf '1 24 "%s"\n' "$WORK/utf8.manifest" >"$WORK/utf8.rc"
    x86_64-w64-mingw32-windres "$WORK/utf8.rc" -O coff -o "$WORK/utf8.o"

    # -static links GCC's C++ runtime and winpthread into each file. --exclude-libs keeps
    # those copies private; exported, they collide when ggml-base.dll is linked next.
    # (Not ALL: CMake hands mingw each target's own objects as an archive too.)
    static="-static -Wl,--exclude-libs,libgcc.a:libgcc_eh.a:libstdc++.a:libwinpthread.a:libpthread.a"
    config+=(-DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=x86_64
      -DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc-posix -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++-posix
      -DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres
      -DBUILD_SHARED_LIBS=ON -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DGGML_OPENMP=OFF
      # MSVC-style names (ggml-cpu-haswell.dll, not libggml-…): the ggml loader looks for "ggml-*.dll".
      -DCMAKE_SHARED_LIBRARY_PREFIX= -DCMAKE_SHARED_MODULE_PREFIX= -DCMAKE_IMPORT_LIBRARY_PREFIX=
      -DCMAKE_EXE_LINKER_FLAGS="$static $WORK/utf8.o"
      -DCMAKE_SHARED_LINKER_FLAGS="$static" -DCMAKE_MODULE_LINKER_FLAGS="$static")
    files=(whisper-cli.exe)
    ;;
  *)
    echo "unknown target: $TARGET" >&2
    exit 1
    ;;
esac

cmake "${config[@]}" >"$WORK/cmake.log" 2>&1 || { tail -30 "$WORK/cmake.log" >&2; exit 1; }
jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
cmake --build "$WORK/build" --config Release -j "$jobs" --target whisper-cli >"$WORK/build.log" 2>&1 ||
  { tail -40 "$WORK/build.log" >&2; exit 1; }

mkdir -p "$OUT"
bin="$WORK/build/bin"
for f in "${files[@]}"; do cp "$bin/$f" "$OUT/$f"; done
# Windows: libwhisper.dll, ggml.dll, ggml-base.dll and every ggml-cpu-*.dll variant.
# Stripping drops the symbol tables, about 42 MB -> 27 MB for the whole set.
if [ "$TARGET" = win-x64 ]; then
  x86_64-w64-mingw32-strip --strip-unneeded "$bin/whisper-cli.exe" "$bin"/*.dll
  cp "$bin/whisper-cli.exe" "$bin"/*.dll "$OUT/"
fi
echo "    -> $OUT"
