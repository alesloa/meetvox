#!/usr/bin/env bash
# Build the small ffmpeg Meetvox bundles, from the pinned FFmpeg source release.
#
#   bash scripts/binaries/ffmpeg.sh mac-arm64|mac-x64|win-x64
#
# Output: resources/<target>/ffmpeg (or ffmpeg.exe), or $OUT when set.
#
# License: no --enable-gpl and no --enable-nonfree, so the binary is LGPL-2.1-or-later.
# The flags keep only what Meetvox runs: WAV in/out, channelsplit + volumedetect for
# recordings, and the demuxers/decoders the Import dialog offers (mp3, m4a/mp4, flac,
# ogg, opus, webm/mkv, wma, aiff). All decoders are FFmpeg's own; nothing external.
#
# mac-*:  needs Xcode command line tools. Runs on macOS 13.3+ (same floor as whisper-cli).
# win-x64: needs the mingw-w64 cross compiler (x86_64-w64-mingw32-gcc). build.sh runs this
#          inside Docker when it isn't installed.
set -euo pipefail

VERSION=7.1.5
# SHA-256 of ffmpeg-7.1.5.tar.xz. The tarball's .asc verifies with the FFmpeg release
# signing key (FCF986EA15E6E293A5644F10B4322F04D67658D8, https://ffmpeg.org/ffmpeg-devel.asc).
SHA256=de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f
MACOS_MIN=13.3

TARGET=${1:?usage: ffmpeg.sh mac-arm64|mac-x64|win-x64}
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT=${OUT:-$ROOT/resources/$TARGET}
WORK="$(mktemp -d "${TMPDIR:-/tmp}/meetvox-ffmpeg-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi; }

echo "==> ffmpeg $VERSION for $TARGET"
curl -fsSL -o "$WORK/ffmpeg.tar.xz" "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
got="$(sha256 "$WORK/ffmpeg.tar.xz" | cut -d' ' -f1)"
if [ "$got" != "$SHA256" ]; then
  echo "ffmpeg-$VERSION.tar.xz has SHA-256 $got, expected $SHA256" >&2
  exit 1
fi
tar -xJf "$WORK/ffmpeg.tar.xz" -C "$WORK"
cd "$WORK/ffmpeg-$VERSION"

config=(
  --disable-everything --disable-autodetect --disable-network --disable-doc --disable-debug
  --disable-programs --enable-ffmpeg --disable-x86asm --disable-asm
  --enable-protocol=file
  --enable-demuxer=wav,mov,matroska,ogg,mp3,flac,aiff,asf
  --enable-muxer=wav,null
  --enable-decoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8,pcm_s16be,pcm_s24be,pcm_s32be,pcm_f32be,aac,mp3,flac,vorbis,opus,alac,wmav1,wmav2
  --enable-encoder=pcm_s16le
  --enable-filter=channelsplit,channelmap,volumedetect,aresample,aformat,anull
  --enable-static --disable-shared --enable-small
)

case "$TARGET" in
  mac-arm64 | mac-x64)
    arch=arm64
    [ "$TARGET" = mac-x64 ] && arch=x86_64 && config+=(--enable-cross-compile --target-os=darwin)
    config+=(--arch="$arch" --cc="clang -arch $arch"
      --extra-cflags="-mmacosx-version-min=$MACOS_MIN" --extra-ldflags="-mmacosx-version-min=$MACOS_MIN")
    exe=ffmpeg
    ;;
  win-x64)
    # -static links libgcc into the exe, so it needs only DLLs that ship with Windows.
    config+=(--enable-cross-compile --target-os=mingw32 --arch=x86_64
      --cross-prefix=x86_64-w64-mingw32- --extra-ldflags=-static)
    exe=ffmpeg.exe
    ;;
  *)
    echo "unknown target: $TARGET" >&2
    exit 1
    ;;
esac

./configure "${config[@]}" >"$WORK/configure.log" || { tail -30 "$WORK/configure.log" >&2; exit 1; }
jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
make -j"$jobs" >"$WORK/make.log" 2>&1 || { tail -30 "$WORK/make.log" >&2; exit 1; }

mkdir -p "$OUT"
cp "$exe" "$OUT/$exe"
echo "    -> $OUT/$exe"
