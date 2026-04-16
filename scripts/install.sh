#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Install the Prefactor CLI from GitHub Releases.

Usage:
  ./scripts/install.sh [stable|latest|<version>]

Examples:
  ./scripts/install.sh
  ./scripts/install.sh latest
  ./scripts/install.sh v0.0.4
EOF
}

log() {
  printf '==> %s\n' "$*"
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

resolve_channel() {
  local selector="$1"
  if [ "$selector" = "stable" ] || [ -z "$selector" ]; then
    printf 'stable'
    return
  fi
  if [ "$selector" = "latest" ]; then
    printf 'latest'
    return
  fi
  if [[ "$selector" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf 'pinned'
    return
  fi
  fail "Unsupported release selector '$selector'. Use stable, latest, or a semver like 0.0.4."
}

normalize_version() {
  local version="$1"
  if [[ "$version" == v* ]]; then
    printf '%s' "$version"
  else
    printf 'v%s' "$version"
  fi
}

detect_platform() {
  local uname_s="${PREFACTOR_INSTALL_TEST_UNAME_S:-$(uname -s)}"
  case "$uname_s" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *) fail "Unsupported operating system: $uname_s" ;;
  esac
}

detect_arch() {
  local platform="$1"
  local uname_m="${PREFACTOR_INSTALL_TEST_UNAME_M:-$(uname -m)}"

  if [ "$platform" = "darwin" ] && [ "$uname_m" = "x86_64" ]; then
    local rosetta="${PREFACTOR_INSTALL_TEST_ROSETTA:-}"
    if [ -z "$rosetta" ] && command_exists sysctl; then
      rosetta="$(sysctl -in sysctl.proc_translated 2>/dev/null || true)"
    fi
    if [ "$rosetta" = "1" ]; then
      printf 'arm64'
      return
    fi
  fi

  case "$uname_m" in
    arm64|aarch64) printf 'arm64' ;;
    x86_64|amd64) printf 'x64' ;;
    *) fail "Unsupported architecture: $uname_m" ;;
  esac
}

detect_libc() {
  if [ "$1" != "linux" ]; then
    printf ''
    return
  fi

  if [ -n "${PREFACTOR_INSTALL_TEST_LIBC:-}" ]; then
    printf '%s' "${PREFACTOR_INSTALL_TEST_LIBC}"
    return
  fi

  if command_exists ldd && ldd --version 2>&1 | grep -qi musl; then
    printf 'musl'
    return
  fi

  printf 'glibc'
}

build_asset_name() {
  local platform="$1"
  local arch="$2"
  local libc="$3"
  if [ "$platform" = "darwin" ]; then
    printf 'prefactor-darwin-%s.tar.gz' "$arch"
    return
  fi
  if [ "$platform" = "linux" ]; then
    if [ "$libc" = "musl" ]; then
      printf 'prefactor-linux-%s-musl.tar.gz' "$arch"
      return
    fi
    printf 'prefactor-linux-%s.tar.gz' "$arch"
    return
  fi

  fail "Unsupported platform for install.sh: $platform"
}

download_with_curl() {
  local url="$1"
  local output="$2"
  curl -fsSL "$url" -o "$output"
}

download_with_wget() {
  local url="$1"
  local output="$2"
  wget -qO "$output" "$url"
}

download() {
  local url="$1"
  local output="$2"

  if [ "${PREFACTOR_INSTALL_TEST_NO_DOWNLOADERS:-0}" = "1" ]; then
    fail 'Either curl or wget is required.'
  fi

  if command_exists curl; then
    download_with_curl "$url" "$output"
    return
  fi
  if command_exists wget; then
    download_with_wget "$url" "$output"
    return
  fi

  fail 'Either curl or wget is required.'
}

verify_checksum() {
  local asset_path="$1"
  local checksum_path="$2"
  local asset_name="$3"
  local expected actual

  expected="$(awk -v name="$asset_name" '$2 == name || $2 == "*"name { print $1; exit }' "$checksum_path")"
  [ -n "$expected" ] || fail "No checksum entry found for $asset_name."

  if command_exists sha256sum; then
    actual="$(sha256sum "$asset_path" | awk '{ print $1 }')"
  elif command_exists shasum; then
    actual="$(shasum -a 256 "$asset_path" | awk '{ print $1 }')"
  else
    fail 'sha256sum or shasum is required for checksum verification.'
  fi

  [ "$expected" = "$actual" ] || fail "Checksum mismatch for $asset_name."
}

selector="${1:-stable}"
if [ "$selector" = "--help" ] || [ "$selector" = "-h" ]; then
  usage
  exit 0
fi

channel="$(resolve_channel "$selector")"
requested_version=''
if [ "$channel" = "pinned" ]; then
  requested_version="$(normalize_version "$selector")"
fi

if [ "$#" -gt 0 ]; then
  shift
fi

[ "$#" -eq 0 ] || fail "Unknown argument: $1"

platform="$(detect_platform)"
arch="$(detect_arch "$platform")"
libc="$(detect_libc "$platform")"
asset_name="$(build_asset_name "$platform" "$arch" "$libc")"

base_url="${PREFACTOR_RELEASE_BASE_URL:-https://github.com/prefactordev/typescript-sdk/releases/download}"
latest_base_url="${PREFACTOR_RELEASE_LATEST_BASE_URL:-https://github.com/prefactordev/typescript-sdk/releases/latest/download}"

case "$channel" in
  stable)
    asset_url="$latest_base_url/$asset_name"
    checksum_url="$latest_base_url/SHA256SUMS"
    resolved_tag=''
    ;;
  latest)
    asset_url="$base_url/canary/$asset_name"
    checksum_url="$base_url/canary/SHA256SUMS"
    resolved_tag='canary'
    ;;
  pinned)
    asset_url="$base_url/$requested_version/$asset_name"
    checksum_url="$base_url/$requested_version/SHA256SUMS"
    resolved_tag="$requested_version"
    ;;
esac

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

archive_path="$tmp_root/$asset_name"
checksum_path="$tmp_root/SHA256SUMS"
extract_dir="$tmp_root/extracted"
mkdir -p "$extract_dir"

log "Downloading $asset_name"
download "$asset_url" "$archive_path"
download "$checksum_url" "$checksum_path"
verify_checksum "$archive_path" "$checksum_path" "$asset_name"

tar -xzf "$archive_path" -C "$extract_dir"
binary_path="$extract_dir/prefactor"
[ -f "$binary_path" ] || fail "Expected extracted binary at $binary_path"
chmod +x "$binary_path"

install_args=(install)

if [ "$channel" = "pinned" ]; then
  install_args+=(--version "$requested_version")
else
  install_args+=(--channel "$channel")
fi

if [ -n "$resolved_tag" ]; then
  install_args+=(--resolved-tag "$resolved_tag")
fi
install_args+=(--asset-name "$asset_name")

log "Running installer"
"$binary_path" "${install_args[@]}"
