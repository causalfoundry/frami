# Frami

Internal visual bug capture tools for creating screenshot-based Frami tickets.

## Structure

```text
plugin/   Chrome extension for capture and ticket creation
backend/  Go ticket API server and deploy script
skill/    Codex skill for fetching tickets into a local workspace
dist/     Built Chrome extension ZIP
```

## Chrome Extension

Local test install:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `plugin/`.

The popup requires an explicit backend URL and token in **Settings**. It does not assume a runtime default URL.

Draft screenshots, comments, and attachments are stored locally until the user clears them or creates a ticket.

The extension posts tickets to:

```text
POST <backend-url>/tickets
Authorization: Bearer <token>
```

## Backend

The backend stores each ticket as a JSON file under:

```text
/opt/frami/data/tickets/FRAMI-XXXXXX.json
```

Tokens are newline-delimited in:

```text
/opt/frami/tokens
```

Deploy to the VM:

```sh
backend/scripts/deploy.sh user@vm --with-certbot
```

After HTTPS is set up once, later deploys can usually omit `--with-certbot`:

```sh
backend/scripts/deploy.sh user@vm
```

The privacy policy is served at:

```text
https://<backend-domain>/privacy
```

The deployed policy file lives at:

```text
/opt/frami/privacy-policy.html
```

## Agent Skill

Install the Frami ticket skill for Codex and Claude:

```sh
./skill/install.sh
```

If `~/.frami/config` is missing, the installer prompts for the backend URL and token. For noninteractive install, provide env vars:

```sh
FRAMI_SERVER_URL=https://your-frami-server.example.com FRAMI_TOKEN=token-value ./skill/install.sh
```

The installer writes:

```text
~/.frami/config
```

with:

```text
url=https://your-frami-server.example.com
token=token-value
```

Then ask Codex:

```text
Use frami-ticket to check FRAMI-ABC123.
```

The skill writes fetched artifacts to:

```text
.frami/tickets/FRAMI-ABC123/
```

`.frami/` is ignored by git.
