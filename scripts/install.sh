#!/usr/bin/env bash
set -euo pipefail

REPO="prefactordev/typescript-sdk"
BIN_NAME="prefactor"
# Allow PREFACTOR_INSTALL_DIR env override; default to /usr/local/bin
INSTALL_DIR="${PREFACTOR_INSTALL_DIR:-/usr/local/bin}"

main() {
  local os arch asset version install_path tmp_file

  # Detect OS
  case "$(uname -s)" in
    Linux)            os="linux"   ;;
    Darwin)           os="macos"   ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
  esac

  # Detect arch
  case "$(uname -m)" in
    x86_64|amd64)    arch="x64"   ;;
    arm64|aarch64)   arch="arm64" ;;
    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
  esac

  # Resolve asset filename
  if [[ "$os" == "windows" ]]; then
    asset="prefactor-${os}-${arch}.exe"
  else
    asset="prefactor-${os}-${arch}"
  fi

  # Get version: use arg or fetch latest from GitHub API
  if [[ "${1:-}" != "" ]]; then
    version="$1"
  else
    echo "Fetching latest release version..."
    version=$(fetch "https://api.github.com/repos/${REPO}/releases/latest" \
      | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
  fi

  local url="https://github.com/${REPO}/releases/download/${version}/${asset}"

  # Fall back to ~/.local/bin if INSTALL_DIR is not writable
  if [[ ! -w "$INSTALL_DIR" ]]; then
    INSTALL_DIR="$HOME/.local/bin"
    mkdir -p "$INSTALL_DIR"
    echo "Note: installing to $INSTALL_DIR (add to PATH if needed)"
  fi

  install_path="${INSTALL_DIR}/${BIN_NAME}"
  tmp_file="$(mktemp)"
  trap 'rm -f "$tmp_file"' EXIT

  echo "Downloading ${asset} (${version})..."
  fetch "$url" > "$tmp_file"
  chmod +x "$tmp_file"
  mv "$tmp_file" "$install_path"

  echo "Installed: $install_path"
  "$install_path" --version
}

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$1"
  else
    echo "Error: curl or wget is required" >&2; exit 1
  fi
}

main "$@"
