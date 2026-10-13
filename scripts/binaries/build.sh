#!/usr/bin/env bash
# Build every native binary Meetvox bundles, from pinned upstream sources.
#
#   npm run binaries:mac  -> resources/mac-arm64 + resources/mac-x64:
#                            whisper-cli, ffmpeg, meetvox-syscap (needs Xcode tools, cmake, git)
#   npm run binaries:win  -> resources/win-x64: whisper-cli.exe + DLLs, ffmpeg.exe
#
# The Windows files are cross-compiled with mingw-w64, the open-source GCC for Windows.
# With x86_64-w64-mingw32-g++-posix on PATH (Debian/Ubuntu/WSL:
# apt install g++-mingw-w64-x86-64-posix) they build right here. Otherwise they build in
# a pinned Debian container through Docker, so macOS and Linux need nothing else.
#
# Set OUT to send everything to one other folder instead of resources/<target>.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE=debian:trixie@sha256:913f6706df59a68922d1dd08f78c2476560a8d367897200a6005b00e5f67c2d5
# gcc + libc6-dev: FFmpeg's configure needs a host C compiler next to the cross one.
PACKAGES="ca-certificates curl git cmake make xz-utils gcc libc6-dev binutils-mingw-w64-x86-64 gcc-mingw-w64-x86-64-posix g++-mingw-w64-x86-64-posix"

case "${1:-}" in
  mac)
    for target in mac-arm64 mac-x64; do
      bash "$HERE/whisper.sh" "$target"
      bash "$HERE/ffmpeg.sh" "$target"
    done
    bash "$ROOT/native/meetvox-syscap/build.sh"
    ;;
  win)
    if command -v x86_64-w64-mingw32-g++-posix >/dev/null; then
      bash "$HERE/whisper.sh" win-x64
      bash "$HERE/ffmpeg.sh" win-x64
    elif command -v docker >/dev/null; then
      echo "==> mingw-w64 isn't installed here; building in Docker ($IMAGE)"
      # docker cp in and out instead of a bind mount, so it works with any Docker setup.
      cid="$(docker create "$IMAGE" bash -c "apt-get update -qq &&
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends $PACKAGES >/dev/null &&
        OUT=/out bash /scripts/binaries/build.sh win")"
      trap 'docker rm -f "$cid" >/dev/null' EXIT
      # No extended attributes: Docker rejects macOS ones like com.apple.provenance.
      COPYFILE_DISABLE=1 tar --no-xattrs -C "$ROOT" -cf - scripts/binaries | docker cp - "$cid:/"
      docker start -a "$cid"
      dest="${OUT:-$ROOT/resources/win-x64}"
      mkdir -p "$dest"
      docker cp "$cid:/out/." "$dest/"
      echo "    -> $dest"
    else
      echo "Building the Windows binaries needs mingw-w64 (apt install g++-mingw-w64-x86-64-posix) or Docker." >&2
      exit 1
    fi
    ;;
  *)
    echo "usage: build.sh mac|win" >&2
    exit 1
    ;;
esac
