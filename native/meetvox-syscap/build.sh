#!/usr/bin/env bash
# Build the meetvox-syscap ScreenCaptureKit helper as separate arch binaries and
# drop them into resources/<platform-dir>/. Run on macOS 13+ with Xcode toolchain.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/Sources/meetvox-syscap/main.swift"
ROOT="$(cd "$HERE/../.." && pwd)"

# Core Audio process tap (AudioHardwareCreateProcessTap) needs macOS 14.2+; the
# system-audio-recording permission flow it uses is 14.4+. Target 14.4.
FRAMEWORKS=(-framework CoreAudio -framework AudioToolbox -framework AVFoundation)

build() {
  local target="$1" outdir="$2"
  mkdir -p "$ROOT/resources/$outdir"
  echo "building meetvox-syscap for $target -> resources/$outdir/"
  swiftc -O -target "$target" "${FRAMEWORKS[@]}" "$SRC" \
    -o "$ROOT/resources/$outdir/meetvox-syscap"
}

build "arm64-apple-macos14.4" "mac-arm64"
build "x86_64-apple-macos14.4" "mac-x64"

echo "done. Remember to codesign + notarize before distribution:"
echo "  codesign --force --options runtime --sign \"Developer ID Application: …\" resources/mac-*/meetvox-syscap"
