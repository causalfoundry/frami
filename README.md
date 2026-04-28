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

Install for a teammate from a public GitHub repo:

```sh
curl -fsSL https://raw.githubusercontent.com/causalfoundry/frami/main/install.sh | bash
```

That installs the Chrome extension source to:

```text
~/frami/plugin
```

It also installs the Frami ticket skill for Codex and Claude.
If `~/.frami/config` does not exist, the installer prompts for the backend domain and token during this step.

Then load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `~/frami/plugin`.

Local test install:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `plugin/`.

The popup requires an explicit backend URL and token in **Settings**. Use a full URL like `https://frami.example.com`, or enter the bare domain `frami.example.com` and Frami will normalize it to HTTPS. Local dev should include scheme and port, for example `http://127.0.0.1:8787`.

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

Token verification endpoint:

```text
GET https://<backend-domain>/auth/verify
Authorization: Bearer <token>
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

The skill files are installed to each agent's normal skill directory:

```text
~/.codex/skills/frami-ticket
~/.claude/skills/frami-ticket
```

`~/.frami/config` is only the Frami URL/token config, not the skill itself. If it is missing, the installer prompts for the backend domain and token, adds `https://` itself, and verifies them against `/auth/verify`. For noninteractive install, provide env vars:

```sh
FRAMI_DOMAIN=your-frami-server.example.com FRAMI_TOKEN=token-value ./skill/install.sh
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

Enter a domain such as `frami.example.com`, not `https://frami.example.com`; the installer stores and verifies it as `https://frami.example.com`.

Re-running the installer refreshes `~/frami/plugin` and the installed Codex/Claude skills. It keeps `~/.frami/config` by default; use `FRAMI_RESET_CONFIG=1` when you want to replace the saved domain/token.

Then ask Codex:

```text
Use frami-ticket to check FRAMI-ABC123.
```

The skill writes fetched artifacts to:

```text
.frami/tickets/FRAMI-ABC123/
```

`.frami/` is ignored by git.
