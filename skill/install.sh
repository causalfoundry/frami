#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$root_dir/skill/frami-ticket"
codex_target="${CODEX_HOME:-$HOME/.codex}/skills/frami-ticket"
claude_target="${CLAUDE_HOME:-$HOME/.claude}/skills/frami-ticket"
config_dir="$HOME/.frami"
config_file="$config_dir/config"

install_one() {
  local target_dir="$1"
  local label="$2"

  mkdir -p "$target_dir/scripts" "$target_dir/agents"
  cp "$source_dir/SKILL.md" "$target_dir/SKILL.md"
  cp "$source_dir/scripts/fetch_ticket.py" "$target_dir/scripts/fetch_ticket.py"
  cp "$source_dir/agents/openai.yaml" "$target_dir/agents/openai.yaml"
  chmod +x "$target_dir/scripts/fetch_ticket.py"

  echo "Installed Frami skill for $label: $target_dir"
}

install_one "$codex_target" "Codex"
install_one "$claude_target" "Claude"

if [[ -f "$config_file" ]]; then
  echo "Frami config already exists: $config_file"
elif [[ -n "${FRAMI_SERVER_URL:-}" && -n "${FRAMI_TOKEN:-}" ]]; then
  mkdir -p "$config_dir"
  umask 077
  {
    printf 'url=%s\n' "$FRAMI_SERVER_URL"
    printf 'token=%s\n' "$FRAMI_TOKEN"
  } > "$config_file"
  chmod 600 "$config_file"
  echo "Created Frami config from FRAMI_SERVER_URL and FRAMI_TOKEN: $config_file"
elif [[ -t 0 ]]; then
  echo
  echo "Create Frami config for ticket fetching."
  printf 'Frami backend URL: '
  read -r frami_url
  printf 'Frami token: '
  read -rs frami_token
  printf '\n'

  if [[ -z "$frami_url" || -z "$frami_token" ]]; then
    echo "Skipped config creation because URL or token was empty." >&2
    echo "Create $config_file later with url=... and token=..."
  else
    mkdir -p "$config_dir"
    umask 077
    {
      printf 'url=%s\n' "$frami_url"
      printf 'token=%s\n' "$frami_token"
    } > "$config_file"
    chmod 600 "$config_file"
    echo "Created Frami config: $config_file"
  fi
else
  echo "No Frami config found and installer is noninteractive."
  echo "Set FRAMI_SERVER_URL and FRAMI_TOKEN before running install, or create $config_file manually."
fi
