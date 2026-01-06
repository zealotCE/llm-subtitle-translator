import html
import os
import re
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs


WEB_HOST = os.getenv("WEB_HOST", "0.0.0.0")
WEB_PORT = int(os.getenv("WEB_PORT", "8000"))
WEB_CONFIG_PATH = os.getenv("WEB_CONFIG_PATH", ".env")
WEB_SCHEMA_PATH = os.getenv("WEB_SCHEMA_PATH", ".env.example")
WEB_TITLE = os.getenv("WEB_TITLE", "Auto Subtitle Settings")

SENSITIVE_KEYS = {
    "DASHSCOPE_API_KEY",
    "OSS_ACCESS_KEY_ID",
    "OSS_ACCESS_KEY_SECRET",
    "LLM_API_KEY",
    "TMDB_API_KEY",
    "TMDB_READ_TOKEN",
    "BANGUMI_ACCESS_TOKEN",
}
SENSITIVE_PATTERNS = ("KEY", "SECRET", "TOKEN", "PASSWORD")
CLEAR_SENTINEL = "__clear__"


def _is_sensitive(key):
    upper = key.upper()
    if key in SENSITIVE_KEYS:
        return True
    return any(part in upper for part in SENSITIVE_PATTERNS)


def _unquote_env_value(value):
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        raw = value[1:-1]
        if value[0] == '"':
            raw = raw.replace("\\\\", "\\").replace('\\"', '"')
        return raw
    return value


def _format_env_value(value):
    if value is None:
        return ""
    if value == "":
        return '""'
    if re.search(r"[\\s#]", value):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def parse_env_lines(lines):
    entries = []
    for line in lines:
        raw = line.rstrip("\n")
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            entries.append({"type": "raw", "raw": raw})
            continue
        if stripped.startswith("export "):
            stripped = stripped[7:]
        if "=" not in stripped:
            entries.append({"type": "raw", "raw": raw})
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip()
        entries.append({"type": "kv", "key": key, "value": _unquote_env_value(value)})
    return entries


def load_env_file(path):
    if not os.path.exists(path):
        return {}, []
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    entries = parse_env_lines(lines)
    data = {}
    for entry in entries:
        if entry.get("type") == "kv":
            data[entry["key"]] = entry.get("value", "")
    return data, entries


def update_env_file(path, updates):
    data, entries = load_env_file(path)
    data.update(updates)
    seen = set()
    new_lines = []
    for entry in entries:
        if entry.get("type") != "kv":
            new_lines.append(entry["raw"])
            continue
        key = entry["key"]
        seen.add(key)
        value = data.get(key, "")
        new_lines.append(f"{key}={_format_env_value(value)}")
    for key, value in data.items():
        if key in seen:
            continue
        new_lines.append(f"{key}={_format_env_value(value)}")
    content = "\n".join(new_lines).rstrip() + "\n"
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    os.replace(tmp_path, path)


def load_schema(path):
    if not os.path.exists(path):
        return []
    sections = []
    current = {"title": "General", "keys": []}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            raw = line.strip()
            if not raw:
                continue
            if raw.startswith("#"):
                title = raw.lstrip("#").strip() or "General"
                if current["keys"]:
                    sections.append(current)
                current = {"title": title, "keys": []}
                continue
            if "=" in raw and not raw.startswith("export "):
                key = raw.split("=", 1)[0].strip()
                if key:
                    current["keys"].append(key)
    if current["keys"]:
        sections.append(current)
    return sections


def render_page(values, sections, message=""):
    used_keys = {key for section in sections for key in section["keys"]}
    extra_keys = [key for key in values.keys() if key not in used_keys]
    if extra_keys:
        sections = sections + [{"title": "Other", "keys": sorted(extra_keys)}]

    def render_input(key):
        sensitive = _is_sensitive(key)
        val = "" if sensitive else values.get(key, "")
        input_type = "password" if sensitive else "text"
        placeholder = "留空保持不变" if sensitive else ""
        help_text = (
            "留空保持不变，填入 __clear__ 以清空"
            if sensitive
            else ""
        )
        return (
            f"<div class='field'>"
            f"<label>{html.escape(key)}</label>"
            f"<input name='{html.escape(key)}' type='{input_type}' "
            f"value='{html.escape(val)}' placeholder='{html.escape(placeholder)}'/>"
            f"<div class='hint'>{html.escape(help_text)}</div>"
            f"</div>"
        )

    blocks = []
    for section in sections:
        fields = "".join(render_input(key) for key in section["keys"])
        blocks.append(
            f"<section><h2>{html.escape(section['title'])}</h2>{fields}</section>"
        )

    notice = f"<div class='notice'>{html.escape(message)}</div>" if message else ""
    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(WEB_TITLE)}</title>
  <style>
    :root {{
      --bg: #f7f4ef;
      --ink: #1f1c18;
      --accent: #c65d31;
      --muted: #6f655a;
      --panel: #fff8ef;
      --border: #e4d8c8;
      --shadow: rgba(0,0,0,0.08);
      --font: "IBM Plex Serif", "Source Han Serif SC", "Noto Serif SC", serif;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: var(--font);
      background: radial-gradient(circle at top, #fff3e1, var(--bg));
      color: var(--ink);
    }}
    header {{
      padding: 32px 24px 12px;
      text-align: center;
    }}
    header h1 {{
      margin: 0;
      font-size: 28px;
      letter-spacing: 0.5px;
    }}
    header p {{
      margin: 8px 0 0;
      color: var(--muted);
    }}
    main {{
      max-width: 980px;
      margin: 0 auto;
      padding: 16px 24px 60px;
    }}
    section {{
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px 20px 6px;
      margin-bottom: 18px;
      box-shadow: 0 12px 24px var(--shadow);
    }}
    h2 {{
      margin: 0 0 12px;
      font-size: 18px;
      color: var(--accent);
    }}
    .field {{
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 12px;
      padding: 10px 0;
      border-top: 1px dashed var(--border);
    }}
    .field:first-of-type {{
      border-top: none;
    }}
    label {{
      font-weight: 600;
    }}
    input {{
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #fff;
      font-size: 14px;
    }}
    .hint {{
      grid-column: 2 / 3;
      color: var(--muted);
      font-size: 12px;
      padding-top: 4px;
    }}
    .actions {{
      margin-top: 18px;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }}
    button {{
      border: none;
      border-radius: 999px;
      padding: 10px 20px;
      background: var(--accent);
      color: #fff;
      font-weight: 600;
      cursor: pointer;
    }}
    .notice {{
      background: #fff1d9;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 14px;
      margin-bottom: 16px;
      color: #7a4a2a;
    }}
    footer {{
      text-align: center;
      color: var(--muted);
      padding: 16px 0 24px;
      font-size: 12px;
    }}
    @media (max-width: 760px) {{
      .field {{
        grid-template-columns: 1fr;
      }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>{html.escape(WEB_TITLE)}</h1>
    <p>修改配置后需要重启服务才会生效。</p>
  </header>
  <main>
    {notice}
    <form method="post">
      {''.join(blocks)}
      <div class="actions">
        <button type="submit">保存配置</button>
      </div>
    </form>
  </main>
  <footer>配置文件：{html.escape(WEB_CONFIG_PATH)}</footer>
</body>
</html>
"""


class SettingsHandler(BaseHTTPRequestHandler):
    def _send_html(self, content, status=200):
        data = content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        values, _entries = load_env_file(WEB_CONFIG_PATH)
        sections = load_schema(WEB_SCHEMA_PATH)
        page = render_page(values, sections)
        self._send_html(page)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length).decode("utf-8")
        params = parse_qs(data, keep_blank_values=True)
        values, _entries = load_env_file(WEB_CONFIG_PATH)
        updates = {}
        for key, vals in params.items():
            if not vals:
                continue
            value = vals[0]
            if _is_sensitive(key):
                if value == "":
                    continue
                if value == CLEAR_SENTINEL:
                    updates[key] = ""
                else:
                    updates[key] = value
            else:
                updates[key] = value
        if updates:
            update_env_file(WEB_CONFIG_PATH, updates)
            values.update(updates)
            message = "保存成功，请重启服务使配置生效。"
        else:
            message = "未修改任何配置。"
        sections = load_schema(WEB_SCHEMA_PATH)
        page = render_page(values, sections, message=message)
        self._send_html(page)

    def log_message(self, format, *args):
        return None


def main():
    server = ThreadingHTTPServer((WEB_HOST, WEB_PORT), SettingsHandler)
    print(f"[web] listening on http://{WEB_HOST}:{WEB_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
