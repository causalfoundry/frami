---
name: frami-ticket
description: Fetch and inspect Frami visual bug tickets for coding agents. Use when the user mentions a Frami ticket ID like FRAMI-ABC123, asks the agent to check a Frami ticket, or needs screenshots, notes, attachments, and metadata from the Frami backend brought into the local workspace.
---

# Frami Ticket

Use this skill to fetch a precise visual bug report from the Frami backend and turn it into local context the coding agent can inspect.

## Workflow

1. Identify the ticket ID. Valid IDs look like `FRAMI-ABC123`.
2. Run the bundled script from the repository or project root:

   ```sh
   python3 <skill-dir>/scripts/fetch_ticket.py FRAMI-ABC123
   ```

3. Read `.frami/tickets/FRAMI-ABC123/summary.md` first.
4. Inspect extracted images in `.frami/tickets/FRAMI-ABC123/screenshots/` and `.frami/tickets/FRAMI-ABC123/attachments/`. Use an image viewer tool when available.
5. Read `.frami/tickets/FRAMI-ABC123/ticket.json` only when the summary omits needed details.
6. Use the ticket comment, screenshot notes, and image evidence as the bug report. Verify the related code before editing.

## Configuration

The script resolves configuration in this order:

- Server URL: `--server-url`, `FRAMI_SERVER_URL`, `.frami/config`, `~/.frami/config`, `.frami/server-url`, then `~/.frami/server-url`.
- Token: `--token`, `FRAMI_TOKEN`, `.frami/config`, `~/.frami/config`, `.frami/token`, then `~/.frami/token`.

Prefer environment variables for temporary sessions:

```sh
export FRAMI_TOKEN="token-value"
```

For a persistent global setup, create `~/.frami/config`:

```sh
mkdir -p ~/.frami
cat > ~/.frami/config <<'EOF'
url=https://your-frami-server.example.com
token=token-value
EOF
chmod 600 ~/.frami/config
```

The installer prompts for a backend domain without `https://`, then writes `url=https://...` into `~/.frami/config` and verifies it with `GET <url>/auth/verify`. For local dev overrides, use `FRAMI_SERVER_URL=http://127.0.0.1:8787`.

For a repo-specific override, create `.frami/config` in the working repo and keep `.frami/` ignored by git.

## Errors

- `401 Unauthorized`: the token the agent used is not loaded by the backend, or the wrong server URL was used. Do not print tokens in chat.
- `404 ticket not found`: authentication worked, but the ticket ID does not exist.
- Missing server URL: ask the user to create `~/.frami/config` with `url=...`.
- Missing token: ask the user to provide `FRAMI_TOKEN` or create `~/.frami/config`.

## Notes

- Do not mark tickets done; the current Frami backend intentionally has no lifecycle endpoint.
- Do not create broad ticket queues or fetch unrelated tickets. Fetch exactly the ID the user gave.
- Do not commit `.frami/` outputs or token files.
