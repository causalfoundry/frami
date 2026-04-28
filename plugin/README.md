# Frami Chrome Extension

Manifest V3 extension for creating Frami visual tickets from browser screenshots.

## Install For Local Testing

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select `/Users/dexian/code/frami/plugin`.

After edits, click the extension card's reload button in `chrome://extensions`.

## What It Sends

The popup captures selected areas, adds notes and optional image attachments, then sends:

```text
POST <server-url>/tickets
```

The backend URL is configured in the popup settings. The popup trims trailing slashes and does not assume a runtime default URL.

Draft screenshots, comments, and attachments are stored locally until the user clears them or creates a ticket.

For now, ticket creation uses the saved token as:

```text
Authorization: Bearer <token>
```

## Expected Server Response

```json
{
  "id": "FRAMI-8K4P2",
  "url": "https://frami.example.com/tickets/FRAMI-8K4P2"
}
```
