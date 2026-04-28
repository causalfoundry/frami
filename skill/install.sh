#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$root_dir/skill/frami-ticket"
codex_target="${CODEX_HOME:-$HOME/.codex}/skills/frami-ticket"
claude_target="${CLAUDE_HOME:-$HOME/.claude}/skills/frami-ticket"
config_dir="$HOME/.frami"
config_file="$config_dir/config"

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

strip_quotes() {
  local value="$1"
  if [[ ${#value} -ge 2 ]]; then
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  printf '%s' "$value"
}

read_config_value() {
  local path="$1"
  local wanted_key="$2"
  local line key value

  [[ -f "$path" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="$(trim "$line")"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" == *=* ]] || continue
    key="$(trim "${line%%=*}")"
    value="$(strip_quotes "$(trim "${line#*=}")")"
    if [[ "$key" == "$wanted_key" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done < "$path"
}

normalize_server_url() {
  local url
  url="$(trim "$1")"
  url="${url%/}"

  if [[ -z "$url" ]]; then
    return 1
  fi

  if [[ "$url" == http://localhost* || "$url" == http://127.0.0.1* || "$url" == http://\[::1\]* ]]; then
    printf '%s' "$url"
    return 0
  fi

  if [[ "$url" == http://* ]]; then
    url="${url#http://}"
  elif [[ "$url" == https://* ]]; then
    url="${url#https://}"
  fi
  url="${url%%/*}"

  if [[ -z "$url" || "$url" == *"://"* ]]; then
    echo "Frami backend domain must be a domain without https://, for example frami.example.com." >&2
    return 1
  fi

  printf 'https://%s' "$url"
}

write_config() {
  local url="$1"
  local token="$2"

  mkdir -p "$config_dir"
  umask 077
  {
    printf 'url=%s\n' "$url"
    printf 'token=%s\n' "$token"
  } > "$config_file"
  chmod 600 "$config_file"
}

verify_config() {
  local url="$1"
  local token="$2"
  local body_file status

  if [[ "${FRAMI_SKIP_VERIFY:-}" == "1" ]]; then
    echo "Skipped Frami token verification because FRAMI_SKIP_VERIFY=1."
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to verify the Frami token." >&2
    return 1
  fi

  body_file="$(mktemp "${TMPDIR:-/tmp}/frami-verify.XXXXXX")"
  status="$(curl -sS --connect-timeout 10 --max-time 20 -o "$body_file" -w '%{http_code}' \
    -H "Authorization: Bearer $token" \
    "$url/auth/verify" 2>/dev/null || true)"
  rm -f "$body_file"

  case "$status" in
    200)
      echo "Verified Frami backend and token: $url"
      ;;
    401|403)
      echo "Frami token verification failed: token was rejected by $url." >&2
      return 1
      ;;
    404)
      echo "Frami token verification failed: $url/auth/verify was not found. Deploy the latest backend first." >&2
      return 1
      ;;
    000|"")
      echo "Frami token verification failed: could not reach $url. Enter the domain as frami.example.com; the installer adds https:// automatically." >&2
      return 1
      ;;
    *)
      echo "Frami token verification failed: $url/auth/verify returned HTTP $status." >&2
      return 1
      ;;
  esac
}

resolve_config_url() {
  local value=""
  if [[ -n "${FRAMI_DOMAIN:-}" ]]; then
    value="$FRAMI_DOMAIN"
  elif [[ -n "${FRAMI_SERVER_URL:-}" ]]; then
    value="$FRAMI_SERVER_URL"
  elif [[ -f "$config_file" ]]; then
    value="$(read_config_value "$config_file" "url")"
    if [[ -z "$value" ]]; then
      value="$(read_config_value "$config_file" "server_url")"
    fi
  fi

  if [[ -n "$value" ]]; then
    normalize_server_url "$value"
  fi
}

resolve_config_token() {
  if [[ -n "${FRAMI_TOKEN:-}" ]]; then
    printf '%s' "$FRAMI_TOKEN"
  elif [[ -f "$config_file" ]]; then
    read_config_value "$config_file" "token"
  fi
}

install_one() {
  local target_dir="$1"
  local label="$2"
  local tmp_dir

  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/frami-skill.XXXXXX")"
  mkdir -p "$tmp_dir/scripts" "$tmp_dir/agents"
  cp "$source_dir/SKILL.md" "$tmp_dir/SKILL.md"
  cp "$source_dir/scripts/fetch_ticket.py" "$tmp_dir/scripts/fetch_ticket.py"
  cp "$source_dir/agents/openai.yaml" "$tmp_dir/agents/openai.yaml"
  chmod +x "$tmp_dir/scripts/fetch_ticket.py"

  rm -rf "$target_dir"
  mkdir -p "$(dirname "$target_dir")"
  mv "$tmp_dir" "$target_dir"

  echo "Installed or refreshed Frami skill for $label: $target_dir"
}

if [[ "${FRAMI_RESET_CONFIG:-}" == "1" ]]; then
  rm -f "$config_file"
fi

if [[ -f "$config_file" ]]; then
  echo "Keeping existing Frami config: $config_file"
  echo "Set FRAMI_RESET_CONFIG=1 to replace it during install."
elif [[ -n "${FRAMI_DOMAIN:-}" && -n "${FRAMI_TOKEN:-}" ]]; then
  frami_url="$(normalize_server_url "$FRAMI_DOMAIN")"
  write_config "$frami_url" "$FRAMI_TOKEN"
  echo "Created Frami config from FRAMI_DOMAIN and FRAMI_TOKEN: $config_file"
elif [[ -n "${FRAMI_SERVER_URL:-}" && -n "${FRAMI_TOKEN:-}" ]]; then
  frami_url="$(normalize_server_url "$FRAMI_SERVER_URL")"
  write_config "$frami_url" "$FRAMI_TOKEN"
  echo "Created Frami config from FRAMI_SERVER_URL and FRAMI_TOKEN: $config_file"
elif [[ -r /dev/tty && -w /dev/tty ]]; then
  {
    echo
    echo "Create Frami config for ticket fetching."
    echo "Enter the backend domain only, for example frami.example.com."
    echo "Do not include https://; the installer adds it automatically."
    printf 'Frami backend domain: '
  } > /dev/tty
  read -r frami_domain < /dev/tty
  printf 'Frami token: ' > /dev/tty
  read -rs frami_token < /dev/tty
  printf '\n' > /dev/tty

  if [[ -z "$frami_domain" || -z "$frami_token" ]]; then
    echo "Skipped config creation because domain or token was empty." >&2
    echo "Create $config_file later with url=... and token=..."
  else
    frami_url="$(normalize_server_url "$frami_domain")"
    write_config "$frami_url" "$frami_token"
    echo "Created Frami config: $config_file"
  fi
else
  echo "No Frami config found and installer is noninteractive."
  echo "Set FRAMI_DOMAIN and FRAMI_TOKEN before running install, or create $config_file manually."
fi

resolved_url="$(resolve_config_url)"
resolved_token="$(resolve_config_token)"
if [[ -n "$resolved_url" && -n "$resolved_token" ]]; then
  verify_config "$resolved_url" "$resolved_token"
elif [[ -f "$config_file" ]]; then
  echo "Frami config is missing url or token. Edit $config_file and use url=https://frami.example.com and token=..." >&2
  exit 1
fi

install_one "$codex_target" "Codex"
install_one "$claude_target" "Claude"
