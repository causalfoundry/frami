# Frami Backend

Small filesystem-backed ticket API.

## Run Locally

```sh
mkdir -p /tmp/frami/data
printf 'dev-token\n' > /tmp/frami/tokens
go run . -addr :8787 -data-dir /tmp/frami/data -token-file /tmp/frami/tokens
```

Create a ticket:

```sh
curl -sS -X POST http://127.0.0.1:8787/tickets \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"source":"test","comment":"overall","screenshots":[{"note":"image note","dataUrl":"data:image/png;base64,AA=="}]}'
```

Fetch a ticket:

```sh
curl -sS http://127.0.0.1:8787/tickets/FRAMI-ABC123 \
  -H 'Authorization: Bearer dev-token'
```

Public privacy policy page:

```sh
curl -sS http://127.0.0.1:8787/privacy
```

The deploy script installs `backend/privacy-policy.html` to:

```text
/opt/frami/privacy-policy.html
```

## VM Layout

```text
/opt/frami/frami-backend
/opt/frami/tokens
/opt/frami/data/tickets/FRAMI-XXXXXX.json
```

`/opt/frami/tokens` is newline-delimited:

```text
# comments allowed
token-one
token-two
```

## systemd

```sh
sudo useradd --system --home /opt/frami --shell /usr/sbin/nologin frami
sudo mkdir -p /opt/frami/data
sudo cp frami-backend /opt/frami/frami-backend
sudo cp frami-backend.service /etc/systemd/system/frami-backend.service
sudo install -o root -g frami -m 0640 tokens /opt/frami/tokens
sudo chown -R frami:frami /opt/frami/data
sudo chmod 0750 /opt/frami /opt/frami/data
sudo systemctl daemon-reload
sudo systemctl enable --now frami-backend
```

## Deploy To A VM

```sh
backend/scripts/deploy.sh ubuntu@1.2.3.4 --token dev-token
```

With nginx domain config:

```sh
backend/scripts/deploy.sh ubuntu@vm.example.com \
  --domain frami.example.com \
  --base-url https://frami.example.com \
  --privacy-contact privacy@example.com \
  --token-file ./tokens \
  --with-certbot
```
