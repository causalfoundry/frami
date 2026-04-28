#!/usr/bin/env bash
set -euo pipefail

script_path="${BASH_SOURCE[0]:-}"
if [[ -n "$script_path" && -f "$script_path" ]]; then
  repo_root="$(cd "$(dirname "$script_path")" && pwd)"
else
  repo_root="$(pwd)"
fi
install_dir="${FRAMI_INSTALL_DIR:-$HOME/frami}"
source_root="$repo_root"
cleanup_dir=""

cleanup() {
  if [[ -n "$cleanup_dir" ]]; then
    rm -rf "$cleanup_dir"
  fi
}
trap cleanup EXIT

download_source_if_needed() {
  local archive_url archive_file extracted

  if [[ -f "$source_root/plugin/manifest.json" && -f "$source_root/skill/frami-ticket/SKILL.md" ]]; then
    return 0
  fi

  if [[ -n "${FRAMI_ARCHIVE_URL:-}" ]]; then
    archive_url="$FRAMI_ARCHIVE_URL"
  elif [[ -n "${FRAMI_REPO:-}" ]]; then
    archive_url="${FRAMI_REPO%/}/archive/refs/heads/${FRAMI_REF:-main}.tar.gz"
  else
    archive_url="https://github.com/causalfoundry/frami/archive/refs/heads/${FRAMI_REF:-main}.tar.gz"
  fi

  echo "Downloading Frami from $archive_url..."

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to download Frami from GitHub." >&2
    exit 1
  fi
  if ! command -v tar >/dev/null 2>&1; then
    echo "tar is required to unpack Frami from GitHub." >&2
    exit 1
  fi

  cleanup_dir="$(mktemp -d "${TMPDIR:-/tmp}/frami-install.XXXXXX")"
  archive_file="$cleanup_dir/frami.tar.gz"
  curl -fsSL "$archive_url" -o "$archive_file"
  tar -xzf "$archive_file" -C "$cleanup_dir"
  extracted="$(find "$cleanup_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "$extracted" || ! -d "$extracted/plugin" || ! -d "$extracted/skill" ]]; then
    echo "Downloaded archive did not contain plugin/ and skill/." >&2
    exit 1
  fi
  source_root="$extracted"
}

copy_dir() {
  local source="$1"
  local target="$2"

  mkdir -p "$(dirname "$target")"
  if command -v rsync >/dev/null 2>&1; then
    mkdir -p "$target"
    rsync -a --delete "$source"/ "$target"/
  else
    rm -rf "$target"
    cp -R "$source" "$target"
  fi
}

download_source_if_needed

mkdir -p "$install_dir"
copy_dir "$source_root/plugin" "$install_dir/plugin"
copy_dir "$source_root/skill" "$install_dir/skill"
chmod +x "$install_dir/skill/install.sh"

if [[ -f "$source_root/README.md" ]]; then
  cp "$source_root/README.md" "$install_dir/README.md"
fi

echo "Installed Frami app bundle: $install_dir"
echo "Chrome extension folder: $install_dir/plugin"

echo
echo "To load the Chrome extension:"
echo "1. Open chrome://extensions"
echo "2. Enable Developer mode"
echo "3. Click Load unpacked"
echo "4. Select $install_dir/plugin"
echo

"$install_dir/skill/install.sh"
