#!/usr/bin/env python3
import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


CONFIG_FILENAMES = (Path(".frami/config"), Path.home() / ".frami/config")
TICKET_RE = re.compile(r"^FRAMI-[A-Z0-9]{6}$")
DATA_URL_RE = re.compile(r"^data:([^;,]+)?((?:;[^,]*)?),(.*)$", re.DOTALL)


def main():
    args = parse_args()
    ticket = load_ticket(args)
    ticket_id = normalize_ticket_id(args.ticket_id or ticket.get("id", ""))
    if not ticket_id:
        raise SystemExit("Missing ticket id. Provide FRAMI-ABC123 or use an input JSON that contains id.")
    if ticket.get("id") and ticket.get("id") != ticket_id:
        print(f"warning: input JSON id {ticket.get('id')} does not match requested {ticket_id}", file=sys.stderr)

    output_dir = Path(args.output_dir or Path(".frami") / "tickets" / ticket_id)
    output_dir.mkdir(parents=True, exist_ok=True)

    ticket_path = output_dir / "ticket.json"
    ticket_path.write_text(json.dumps(ticket, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    extracted = []
    if not args.no_images:
        extracted = extract_images(ticket, output_dir)

    summary_path = output_dir / "summary.md"
    summary_path.write_text(render_summary(ticket, ticket_id, output_dir, extracted), encoding="utf-8")

    print(f"Fetched {ticket_id}")
    print(f"Summary: {summary_path}")
    print(f"JSON: {ticket_path}")
    if extracted:
        print("Images:")
        for item in extracted:
            print(f"- {item['path']}")


def parse_args():
    parser = argparse.ArgumentParser(description="Fetch and extract a Frami ticket.")
    parser.add_argument("ticket_id", nargs="?", help="Ticket ID, for example FRAMI-ABC123.")
    parser.add_argument("--server-url", help="Frami server URL. Overrides FRAMI_SERVER_URL and Frami config files.")
    parser.add_argument("--token", help="Bearer token. Prefer FRAMI_TOKEN or Frami config files so it is not stored in shell history.")
    parser.add_argument("--output-dir", help="Directory to write ticket.json, summary.md, and extracted images.")
    parser.add_argument("--input-json", help="Process an already downloaded ticket JSON instead of calling the backend.")
    parser.add_argument("--no-images", action="store_true", help="Save ticket JSON and summary without extracting image files.")
    return parser.parse_args()


def load_ticket(args):
    if args.input_json:
        with open(args.input_json, "r", encoding="utf-8") as handle:
            return json.load(handle)

    ticket_id = normalize_ticket_id(args.ticket_id or "")
    if not ticket_id:
        raise SystemExit("Missing or invalid ticket id. Expected FRAMI-ABC123.")

    config = load_config()
    server_url = resolve_server_url(args, config).rstrip("/")
    token = resolve_token(args, config)
    url = f"{server_url}/tickets/{ticket_id}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "frami-ticket-skill/0.1",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace").strip()
        if error.code == 401:
            raise SystemExit("401 Unauthorized. Check FRAMI_TOKEN, FRAMI_SERVER_URL, or ~/.frami/config; do not print the token.")
        if error.code == 404:
            raise SystemExit(f"404 ticket not found: {ticket_id}")
        raise SystemExit(f"HTTP {error.code} from {url}: {body or error.reason}")
    except urllib.error.URLError as error:
        raise SystemExit(f"Could not reach {url}: {error.reason}")

    try:
        return json.loads(data.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit(f"Backend did not return valid JSON: {error}")


def resolve_server_url(args, config):
    if args.server_url:
        return args.server_url.strip()
    if os.environ.get("FRAMI_SERVER_URL"):
        return os.environ["FRAMI_SERVER_URL"].strip()
    if config.get("url"):
        return config["url"]
    if config.get("server_url"):
        return config["server_url"]
    for path in (Path(".frami/server-url"), Path.home() / ".frami/server-url"):
        if path.exists():
            value = path.read_text(encoding="utf-8").strip()
            if value:
                return value
    raise SystemExit("Missing server URL. Set FRAMI_SERVER_URL or create ~/.frami/config with url=...")


def resolve_token(args, config):
    if args.token:
        return args.token.strip()
    if os.environ.get("FRAMI_TOKEN"):
        return os.environ["FRAMI_TOKEN"].strip()
    if config.get("token"):
        return config["token"]
    for path in (Path(".frami/token"), Path.home() / ".frami/token"):
        if path.exists():
            value = path.read_text(encoding="utf-8").strip()
            if value:
                return value
    raise SystemExit("Missing token. Set FRAMI_TOKEN or create ~/.frami/config with token=...")


def load_config():
    config = {}
    for path in CONFIG_FILENAMES:
        if not path.exists():
            continue
        config.update(parse_config(path))
    return config


def parse_config(path):
    config = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise SystemExit(f"Invalid Frami config line in {path}:{line_number}. Expected key=value.")
        key, value = line.split("=", 1)
        key = key.strip().lower().replace("-", "_")
        value = strip_optional_quotes(value.strip())
        if key in {"url", "server_url", "token"} and value:
            config[key] = value
    return config


def strip_optional_quotes(value):
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def normalize_ticket_id(value):
    ticket_id = value.strip().upper()
    return ticket_id if TICKET_RE.match(ticket_id) else ""


def extract_images(ticket, output_dir):
    extracted = []
    screenshots = normalize_list(ticket.get("screenshots"))
    legacy = ticket.get("screenshot")
    if isinstance(legacy, dict) and legacy not in screenshots:
        screenshots.insert(0, legacy)

    for index, image in enumerate(screenshots, start=1):
        item = write_image(image, output_dir / "screenshots", f"screenshot-{index:02d}")
        if item:
            item["kind"] = "screenshot"
            item["index"] = index
            item["note"] = image.get("note") or image.get("comment") or ""
            extracted.append(item)

    attachments = normalize_list(ticket.get("attachments"))
    for index, image in enumerate(attachments, start=1):
        base = safe_stem(image.get("name")) or f"attachment-{index:02d}"
        item = write_image(image, output_dir / "attachments", base)
        if item:
            item["kind"] = "attachment"
            item["index"] = index
            item["note"] = image.get("note") or ""
            extracted.append(item)

    return extracted


def normalize_list(value):
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def write_image(image, directory, stem):
    data_url = image.get("dataUrl") or image.get("dataURL") or ""
    if not isinstance(data_url, str) or not data_url:
        return None

    parsed = parse_data_url(data_url)
    if not parsed:
        return None

    mime_type, payload = parsed
    extension = extension_for_mime(mime_type)
    directory.mkdir(parents=True, exist_ok=True)
    path = unique_path(directory / f"{stem}{extension}")
    path.write_bytes(payload)
    return {
        "path": path,
        "mimeType": mime_type,
        "bytes": len(payload),
    }


def parse_data_url(data_url):
    match = DATA_URL_RE.match(data_url)
    if not match:
        return None

    mime_type = match.group(1) or "application/octet-stream"
    options = match.group(2) or ""
    payload = match.group(3)
    if ";base64" in options:
        try:
            return mime_type, base64.b64decode(payload, validate=True)
        except ValueError:
            return mime_type, base64.b64decode(payload)
    return mime_type, urllib.parse.unquote_to_bytes(payload)


def extension_for_mime(mime_type):
    known = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/svg+xml": ".svg",
    }
    return known.get(mime_type) or mimetypes.guess_extension(mime_type) or ".bin"


def unique_path(path):
    if not path.exists():
        return path
    for suffix in range(2, 1000):
        candidate = path.with_name(f"{path.stem}-{suffix}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"could not allocate unique path for {path}")


def safe_stem(value):
    if not isinstance(value, str) or not value.strip():
        return ""
    stem = Path(value).stem
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-")
    return stem[:80]


def render_summary(ticket, ticket_id, output_dir, extracted):
    lines = [f"# {ticket_id}", ""]
    add_field(lines, "Created", ticket.get("createdAt"))
    add_field(lines, "Source", ticket.get("source"))
    add_field(lines, "Version", ticket.get("version"))
    if ticket.get("comment"):
        lines.extend(["", "## Comment", "", str(ticket["comment"]).strip(), ""])

    screenshots = normalize_list(ticket.get("screenshots"))
    legacy = ticket.get("screenshot")
    if isinstance(legacy, dict) and legacy not in screenshots:
        screenshots.insert(0, legacy)
    if screenshots:
        lines.extend(["", "## Screenshots", ""])
        for index, screenshot in enumerate(screenshots, start=1):
            lines.append(f"### Screenshot {index}")
            add_field(lines, "Note", screenshot.get("note") or screenshot.get("comment"))
            tab = screenshot.get("tab") or {}
            page = screenshot.get("page") or {}
            add_field(lines, "Title", tab.get("title") or page.get("title"))
            add_field(lines, "URL", tab.get("url") or page.get("url"))
            add_field(lines, "Captured", screenshot.get("capturedAt"))
            crop = screenshot.get("crop")
            if crop:
                add_field(lines, "Crop", json.dumps(crop, ensure_ascii=False))
            image_path = find_extracted_path(extracted, "screenshot", index, output_dir)
            add_field(lines, "File", image_path)
            lines.append("")

    attachments = normalize_list(ticket.get("attachments"))
    if attachments:
        lines.extend(["## Attachments", ""])
        for index, attachment in enumerate(attachments, start=1):
            name = attachment.get("name") or f"attachment {index}"
            lines.append(f"- {name}")
            image_path = find_extracted_path(extracted, "attachment", index, output_dir)
            if image_path:
                lines.append(f"  File: {image_path}")
        lines.append("")

    lines.extend(["## Raw Data", "", f"- JSON: {relative_to(output_dir / 'ticket.json', output_dir)}", ""])
    return "\n".join(lines)


def add_field(lines, label, value):
    if value is None or value == "":
        return
    lines.append(f"- {label}: {value}")


def find_extracted_path(extracted, kind, index, output_dir):
    for item in extracted:
        if item.get("kind") == kind and item.get("index") == index:
            return relative_to(item["path"], output_dir)
    return ""


def relative_to(path, base):
    try:
        return str(Path(path).relative_to(base))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    main()
