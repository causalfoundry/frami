#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  backend/scripts/deploy.sh user@vm [options]

Options:
  --domain DOMAIN          Nginx server_name. Defaults to frami.kenkai.io.
  --base-url URL           Public base URL. Defaults to http://DOMAIN or http://HOST.
  --privacy-contact EMAIL  Contact email shown on /privacy. Defaults to privacy@kenkai.io.
  --token TOKEN            Ensure this token exists in /opt/frami/tokens.
  --token-file FILE        Upload newline-delimited token file to /opt/frami/tokens.
  --ssh-port PORT          SSH port. Defaults to 22.
  --with-certbot           Use/install certbot and request HTTPS cert for --domain.
  --skip-nginx             Do not install/configure nginx.

Examples:
  backend/scripts/deploy.sh ubuntu@1.2.3.4
  backend/scripts/deploy.sh ubuntu@vm.example.com --domain frami.example.com --token-file ./tokens --with-certbot
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

TARGET="$1"
shift

DOMAIN="frami.kenkai.io"
BASE_URL=""
TOKEN=""
TOKEN_FILE=""
PRIVACY_CONTACT="privacy@kenkai.io"
SSH_PORT="22"
WITH_CERTBOT="false"
SKIP_NGINX="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:?missing domain}"
      shift 2
      ;;
    --base-url)
      BASE_URL="${2:?missing base url}"
      shift 2
      ;;
    --token)
      TOKEN="${2:?missing token}"
      shift 2
      ;;
    --privacy-contact)
      PRIVACY_CONTACT="${2:?missing privacy contact}"
      shift 2
      ;;
    --token-file)
      TOKEN_FILE="${2:?missing token file}"
      shift 2
      ;;
    --ssh-port)
      SSH_PORT="${2:?missing ssh port}"
      shift 2
      ;;
    --with-certbot)
      WITH_CERTBOT="true"
      shift
      ;;
    --skip-nginx)
      SKIP_NGINX="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

if [[ -z "$BASE_URL" ]]; then
  if [[ "$DOMAIN" != "_" ]]; then
    BASE_URL="https://$DOMAIN"
  else
    BASE_URL="http://${TARGET#*@}"
  fi
fi

if [[ -n "$TOKEN" && -n "$TOKEN_FILE" ]]; then
  echo "Use either --token or --token-file, not both." >&2
  exit 2
fi

echo "Building frami-backend for linux/amd64..."
(
  cd "$BACKEND_DIR"
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o "$BUILD_DIR/frami-backend" .
)

cat > "$BUILD_DIR/frami-backend.service" <<EOF
[Unit]
Description=Frami Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=frami
Group=frami
WorkingDirectory=/opt/frami
ExecStart=/opt/frami/frami-backend -addr 127.0.0.1:8787 -base-url $BASE_URL -data-dir /opt/frami/data -token-file /opt/frami/tokens -privacy-file /opt/frami/privacy-policy.html -privacy-contact $PRIVACY_CONTACT
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/frami/data

[Install]
WantedBy=multi-user.target
EOF

cat > "$BUILD_DIR/frami-nginx.conf" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

escaped_privacy_contact="${PRIVACY_CONTACT//\\/\\\\}"
escaped_privacy_contact="${escaped_privacy_contact//&/\\&}"
escaped_privacy_contact="${escaped_privacy_contact//|/\\|}"
sed "s|privacy@kenkai.io|$escaped_privacy_contact|g" "$BACKEND_DIR/privacy-policy.html" > "$BUILD_DIR/privacy-policy.html"

SSH=(ssh -p "$SSH_PORT" "$TARGET")
SCP=(scp -P "$SSH_PORT")

echo "Uploading artifacts to $TARGET..."
"${SSH[@]}" "mkdir -p /tmp/frami-deploy"
"${SCP[@]}" "$BUILD_DIR/frami-backend" "$BUILD_DIR/frami-backend.service" "$BUILD_DIR/privacy-policy.html" "$TARGET:/tmp/frami-deploy/"
if [[ "$SKIP_NGINX" != "true" ]]; then
  "${SCP[@]}" "$BUILD_DIR/frami-nginx.conf" "$TARGET:/tmp/frami-deploy/"
fi
if [[ -n "$TOKEN_FILE" ]]; then
  "${SCP[@]}" "$TOKEN_FILE" "$TARGET:/tmp/frami-deploy/tokens"
fi

echo "Installing on remote host..."
"${SSH[@]}" "sudo bash -s" <<EOF
set -euo pipefail

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update
  if [[ "$SKIP_NGINX" != "true" ]]; then
    if ! command -v nginx >/dev/null 2>&1; then
      sudo apt-get install -y nginx
    fi
  fi
  if [[ "$WITH_CERTBOT" == "true" ]] && ! command -v certbot >/dev/null 2>&1; then
    sudo apt-get install -y certbot python3-certbot-nginx
  fi
elif command -v dnf >/dev/null 2>&1; then
  if [[ "$SKIP_NGINX" != "true" ]]; then
    if ! command -v nginx >/dev/null 2>&1; then
      sudo dnf install -y nginx
    fi
  fi
  if [[ "$WITH_CERTBOT" == "true" ]] && ! command -v certbot >/dev/null 2>&1; then
    sudo dnf install -y certbot python3-certbot-nginx
  fi
else
  echo "Unsupported package manager. Install nginx manually or use --skip-nginx." >&2
  exit 1
fi

if ! id frami >/dev/null 2>&1; then
  sudo useradd --system --home /opt/frami --shell /usr/sbin/nologin frami
fi

sudo mkdir -p /opt/frami/data/tickets
sudo install -o root -g root -m 0755 /tmp/frami-deploy/frami-backend /opt/frami/frami-backend
sudo install -o root -g root -m 0644 /tmp/frami-deploy/privacy-policy.html /opt/frami/privacy-policy.html
sudo install -o root -g root -m 0644 /tmp/frami-deploy/frami-backend.service /etc/systemd/system/frami-backend.service

if [[ -f /tmp/frami-deploy/tokens ]]; then
  sudo install -o root -g frami -m 0640 /tmp/frami-deploy/tokens /opt/frami/tokens
elif [[ ! -f /opt/frami/tokens ]]; then
  tmp_tokens="\$(mktemp)"
  for _ in 1 2 3; do
    if command -v openssl >/dev/null 2>&1; then
      openssl rand -hex 32 >> "\$tmp_tokens"
    else
      head -c 32 /dev/urandom | base64 | tr -d '\n' >> "\$tmp_tokens"
      printf '\n' >> "\$tmp_tokens"
    fi
  done
  sudo install -o root -g frami -m 0640 "\$tmp_tokens" /opt/frami/tokens
  rm -f "\$tmp_tokens"
  echo "Created /opt/frami/tokens with 3 initial tokens:"
  sudo cat /opt/frami/tokens
fi

if [[ -n "$TOKEN" ]]; then
  if ! sudo grep -Fxq "$TOKEN" /opt/frami/tokens; then
    printf '%s\n' "$TOKEN" | sudo tee -a /opt/frami/tokens >/dev/null
  fi
fi

sudo chown -R frami:frami /opt/frami/data
sudo chmod 0755 /opt/frami
sudo chmod 0750 /opt/frami/data /opt/frami/data/tickets

if [[ "$SKIP_NGINX" != "true" ]]; then
  if [[ ! -x "\$(command -v nginx || true)" ]]; then
    echo "nginx was not found after package install." >&2
    exit 1
  fi

  if [[ -d /etc/nginx/sites-enabled ]]; then
    sudo mkdir -p /etc/nginx/sites-available
    sudo install -o root -g root -m 0644 /tmp/frami-deploy/frami-nginx.conf /etc/nginx/sites-available/frami
    sudo ln -sfn /etc/nginx/sites-available/frami /etc/nginx/sites-enabled/frami
  else
    sudo mkdir -p /etc/nginx/conf.d
    sudo cp /tmp/frami-deploy/frami-nginx.conf /etc/nginx/conf.d/frami.conf
  fi
  sudo nginx -t
  if systemctl is-active --quiet nginx 2>/dev/null; then
    sudo systemctl reload nginx
  elif pgrep -x nginx >/dev/null 2>&1; then
    sudo nginx -s reload
  else
    sudo systemctl enable --now nginx
  fi
fi

sudo systemctl daemon-reload
sudo systemctl enable --now frami-backend
sudo systemctl restart frami-backend

if [[ "$WITH_CERTBOT" == "true" && "$DOMAIN" != "_" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    echo "certbot not found after package install." >&2
    exit 1
  fi
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email
  sudo nginx -t
  if systemctl is-active --quiet nginx 2>/dev/null; then
    sudo systemctl reload nginx
  elif pgrep -x nginx >/dev/null 2>&1; then
    sudo nginx -s reload
  else
    sudo systemctl enable --now nginx
  fi
  if command -v ss >/dev/null 2>&1 && ! sudo ss -ltn | grep -Eq '(^|[.:])443[[:space:]]'; then
    echo "certbot completed, but nothing is listening on port 443. Check nginx SSL config and firewall rules." >&2
    exit 1
  fi
fi

sudo systemctl --no-pager --full status frami-backend || true
EOF

echo "Deployment complete."
echo "Base URL: $BASE_URL"
echo "Health check: $BASE_URL/health"
echo "Privacy policy: $BASE_URL/privacy"
