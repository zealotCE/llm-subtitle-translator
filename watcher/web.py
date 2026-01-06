import cgi
import html
import os
import re
import sqlite3
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


WEB_HOST = os.getenv("WEB_HOST", "0.0.0.0")
WEB_PORT = int(os.getenv("WEB_PORT", "8000"))
WEB_CONFIG_PATH = os.getenv("WEB_CONFIG_PATH", ".env")
WEB_SCHEMA_PATH = os.getenv("WEB_SCHEMA_PATH", ".env.example")
WEB_TITLE = os.getenv("WEB_TITLE", "Auto Subtitle Settings")
WEB_DB_PATH = os.getenv("WEB_DB_PATH", "/app/web.db")
WEB_UPLOAD_DIR = os.getenv("WEB_UPLOAD_DIR", "")
WEB_UPLOAD_OVERWRITE = os.getenv("WEB_UPLOAD_OVERWRITE", "false").lower() == "true"
WEB_MAX_UPLOAD_MB = int(os.getenv("WEB_MAX_UPLOAD_MB", "2048"))
WEB_TRIGGER_SCAN_FILE = os.getenv("WEB_TRIGGER_SCAN_FILE", ".scan_now").strip()
WEB_WATCH_DIRS = os.getenv("WEB_WATCH_DIRS", "")
WEB_LOG_LIMIT = int(os.getenv("WEB_LOG_LIMIT", "200"))

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


def get_watch_dirs():
    if WEB_WATCH_DIRS.strip():
        raw = WEB_WATCH_DIRS
    else:
        data, _entries = load_env_file(WEB_CONFIG_PATH)
        raw = data.get("WATCH_DIRS", "")
    items = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        items.append(_unquote_env_value(part))
    return items


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


def _init_db():
    os.makedirs(os.path.dirname(WEB_DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(WEB_DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS jobs ("
        "id TEXT PRIMARY KEY, "
        "path TEXT NOT NULL, "
        "created_at INTEGER NOT NULL"
        ")"
    )
    conn.commit()
    return conn


def create_job(path):
    job_id = f"job-{int(time.time())}-{abs(hash(path)) % 100000}"
    conn = _init_db()
    conn.execute(
        "INSERT OR REPLACE INTO jobs (id, path, created_at) VALUES (?, ?, ?)",
        (job_id, path, int(time.time())),
    )
    conn.commit()
    conn.close()
    return job_id


def list_jobs():
    conn = _init_db()
    cur = conn.execute("SELECT id, path, created_at FROM jobs ORDER BY created_at DESC")
    rows = cur.fetchall()
    conn.close()
    return rows


def infer_job_status(path):
    base = os.path.splitext(os.path.basename(path))[0]
    out_dir = os.path.dirname(path)
    done_path = os.path.join(out_dir, f"{base}.done")
    lock_path = os.path.join(out_dir, f"{base}.lock")
    if os.path.exists(done_path):
        return "done"
    if os.path.exists(lock_path):
        return "running"
    return "pending"


def trigger_scan():
    watch_dirs = get_watch_dirs()
    if not watch_dirs or not WEB_TRIGGER_SCAN_FILE:
        return False
    for base in watch_dirs:
        os.makedirs(base, exist_ok=True)
        path = os.path.join(base, WEB_TRIGGER_SCAN_FILE)
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write("scan")
        except OSError:
            return False
    return True


def get_log_path():
    data, _entries = load_env_file(WEB_CONFIG_PATH)
    log_dir = data.get("LOG_DIR", "") or os.getenv("LOG_DIR", "")
    log_name = data.get("LOG_FILE_NAME", "") or os.getenv("LOG_FILE_NAME", "worker.log")
    if not log_dir:
        return ""
    return os.path.join(log_dir, log_name)


def read_logs(keyword="", limit=200):
    path = get_log_path()
    if not path or not os.path.exists(path):
        return []
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if keyword and keyword not in line:
                continue
            entries.append(line)
    if limit > 0:
        entries = entries[-limit:]
    return entries


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
    nav a {{
      margin-right: 12px;
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
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
    <nav>
      <a href="/">设置</a>
      <a href="/upload">上传</a>
      <a href="/jobs">任务</a>
      <a href="/logs">日志</a>
    </nav>
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


def render_jobs(jobs, message=""):
    rows = []
    for job_id, path, created_at in jobs:
        status = infer_job_status(path)
        created = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(created_at))
        rows.append(
            "<tr>"
            f"<td>{html.escape(job_id)}</td>"
            f"<td>{html.escape(path)}</td>"
            f"<td>{html.escape(status)}</td>"
            f"<td>{html.escape(created)}</td>"
            "</tr>"
        )
    notice = f"<div class='notice'>{html.escape(message)}</div>" if message else ""
    rows_html = "\n".join(rows) if rows else "<tr><td colspan='4'>暂无任务</td></tr>"
    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>任务列表</title>
  <style>
    body {{ font-family: "IBM Plex Serif", serif; background: #f7f4ef; color: #1f1c18; }}
    main {{ max-width: 1100px; margin: 0 auto; padding: 24px; }}
    table {{ width: 100%; border-collapse: collapse; background: #fff8ef; }}
    th, td {{ border: 1px solid #e4d8c8; padding: 10px; text-align: left; }}
    th {{ background: #f0e2d2; }}
    .notice {{ background: #fff1d9; border: 1px solid #e4d8c8; padding: 10px 12px; border-radius: 10px; }}
    nav a {{ margin-right: 12px; color: #c65d31; text-decoration: none; }}
  </style>
</head>
<body>
  <main>
    <nav>
      <a href="/">设置</a>
      <a href="/upload">上传</a>
      <a href="/jobs">任务</a>
      <a href="/logs">日志</a>
    </nav>
    <h1>任务列表</h1>
    {notice}
    <form method="post" action="/scan" style="margin-bottom: 12px;">
      <button type="submit">触发扫描</button>
    </form>
    <table>
      <thead>
        <tr><th>任务 ID</th><th>路径</th><th>状态</th><th>创建时间</th></tr>
      </thead>
      <tbody>
        {rows_html}
      </tbody>
    </table>
  </main>
</body>
</html>
"""


def render_upload(message=""):
    notice = f"<div class='notice'>{html.escape(message)}</div>" if message else ""
    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>上传媒体</title>
  <style>
    body {{ font-family: "IBM Plex Serif", serif; background: #f7f4ef; color: #1f1c18; }}
    main {{ max-width: 760px; margin: 0 auto; padding: 24px; }}
    form {{ background: #fff8ef; padding: 18px; border: 1px solid #e4d8c8; border-radius: 14px; }}
    nav a {{ margin-right: 12px; color: #c65d31; text-decoration: none; }}
    input[type=file] {{ margin: 12px 0; }}
    button {{ border: none; border-radius: 999px; padding: 10px 20px; background: #c65d31; color: #fff; }}
    .notice {{ background: #fff1d9; border: 1px solid #e4d8c8; padding: 10px 12px; border-radius: 10px; }}
  </style>
</head>
<body>
  <main>
    <nav>
      <a href="/">设置</a>
      <a href="/upload">上传</a>
      <a href="/jobs">任务</a>
      <a href="/logs">日志</a>
    </nav>
    <h1>上传媒体</h1>
    {notice}
    <form method="post" enctype="multipart/form-data">
      <input type="file" name="file" />
      <button type="submit">上传并创建任务</button>
    </form>
  </main>
</body>
</html>
"""


def render_logs(logs, keyword="", limit=200):
    rows = []
    for line in logs:
        rows.append(f"<tr><td>{html.escape(line)}</td></tr>")
    rows_html = "\n".join(rows) if rows else "<tr><td>暂无日志</td></tr>"
    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>日志</title>
  <style>
    body {{ font-family: "IBM Plex Serif", serif; background: #f7f4ef; color: #1f1c18; }}
    main {{ max-width: 1100px; margin: 0 auto; padding: 24px; }}
    table {{ width: 100%; border-collapse: collapse; background: #fff8ef; }}
    td {{ border: 1px solid #e4d8c8; padding: 10px; font-size: 12px; }}
    nav a {{ margin-right: 12px; color: #c65d31; text-decoration: none; }}
    form {{ margin-bottom: 12px; }}
    input {{ padding: 8px 10px; border-radius: 8px; border: 1px solid #e4d8c8; }}
    button {{ border: none; border-radius: 999px; padding: 8px 16px; background: #c65d31; color: #fff; }}
  </style>
</head>
<body>
  <main>
    <nav>
      <a href="/">设置</a>
      <a href="/upload">上传</a>
      <a href="/jobs">任务</a>
      <a href="/logs">日志</a>
    </nav>
    <h1>日志</h1>
    <form method="get">
      <input name="q" placeholder="关键词" value="{html.escape(keyword)}" />
      <input name="limit" placeholder="条数" value="{html.escape(str(limit))}" />
      <button type="submit">筛选</button>
    </form>
    <table>
      <tbody>
        {rows_html}
      </tbody>
    </table>
  </main>
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
        path = urlparse(self.path).path
        if path == "/jobs":
            jobs = list_jobs()
            page = render_jobs(jobs)
            return self._send_html(page)
        if path == "/upload":
            page = render_upload()
            return self._send_html(page)
        if path == "/logs":
            return self._handle_logs()
        values, _entries = load_env_file(WEB_CONFIG_PATH)
        sections = load_schema(WEB_SCHEMA_PATH)
        page = render_page(values, sections)
        self._send_html(page)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/upload":
            return self._handle_upload()
        if path == "/scan":
            ok = trigger_scan()
            jobs = list_jobs()
            page = render_jobs(jobs, message="已触发扫描" if ok else "触发失败")
            return self._send_html(page)
        if path == "/logs":
            return self._handle_logs(post=True)
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

    def _handle_upload(self):
        max_bytes = WEB_MAX_UPLOAD_MB * 1024 * 1024
        if int(self.headers.get("Content-Length", 0)) > max_bytes:
            return self._send_html(render_upload("文件过大"), status=413)
        form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST"})
        file_item = form["file"] if "file" in form else None
        if not file_item or not file_item.filename:
            return self._send_html(render_upload("请选择文件"))

        watch_dirs = get_watch_dirs()
        target_dir = WEB_UPLOAD_DIR or (watch_dirs[0] if watch_dirs else "")
        if not target_dir:
            return self._send_html(render_upload("未配置上传目录"))
        os.makedirs(target_dir, exist_ok=True)
        filename = os.path.basename(file_item.filename)
        dest_path = os.path.join(target_dir, filename)
        if os.path.exists(dest_path) and not WEB_UPLOAD_OVERWRITE:
            return self._send_html(render_upload("文件已存在"))
        with open(dest_path, "wb") as f:
            f.write(file_item.file.read())
        job_id = create_job(dest_path)
        return self._send_html(render_upload(f"上传成功，任务 {job_id} 已创建"))

    def _handle_logs(self, post=False):
        if post:
            length = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(length).decode("utf-8")
            params = parse_qs(data, keep_blank_values=True)
        else:
            params = parse_qs(urlparse(self.path).query, keep_blank_values=True)
        keyword = (params.get("q") or [""])[0].strip()
        limit_raw = (params.get("limit") or [""])[0].strip()
        limit = WEB_LOG_LIMIT
        if limit_raw.isdigit():
            limit = max(1, min(1000, int(limit_raw)))
        logs = read_logs(keyword=keyword, limit=limit)
        page = render_logs(logs, keyword=keyword, limit=limit)
        return self._send_html(page)

    def log_message(self, format, *args):
        return None


def main():
    server = ThreadingHTTPServer((WEB_HOST, WEB_PORT), SettingsHandler)
    print(f"[web] listening on http://{WEB_HOST}:{WEB_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
