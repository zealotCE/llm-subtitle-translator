import html
import json
import os
import re
import sqlite3
import tempfile
import time
import base64
import hmac
import hashlib
from email import policy
from email.parser import BytesParser
import threading
import srt
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse, quote


WEB_HOST = os.getenv("WEB_HOST", "0.0.0.0")
WEB_PORT = int(os.getenv("WEB_PORT", "8000"))
WEB_CONFIG_PATH = os.getenv("WEB_CONFIG_PATH", ".env")
WEB_SCHEMA_PATH = os.getenv("WEB_SCHEMA_PATH", ".env.example")
WEB_TITLE = os.getenv("WEB_TITLE", "Auto Subtitle Settings")
WEB_DB_PATH = os.getenv("WEB_DB_PATH", "web.db")
WEB_UPLOAD_DIR = os.getenv("WEB_UPLOAD_DIR", "")
WEB_UPLOAD_OVERWRITE = os.getenv("WEB_UPLOAD_OVERWRITE", "false").lower() == "true"
WEB_MAX_UPLOAD_MB = int(os.getenv("WEB_MAX_UPLOAD_MB", "2048"))
WEB_TRIGGER_SCAN_FILE = os.getenv("WEB_TRIGGER_SCAN_FILE", ".scan_now").strip()
WEB_WATCH_DIRS = os.getenv("WEB_WATCH_DIRS", "")
WEB_LOG_LIMIT = int(os.getenv("WEB_LOG_LIMIT", "200"))
WEB_UPLOAD_ASR_MODE_DEFAULT = os.getenv("WEB_UPLOAD_ASR_MODE_DEFAULT", "")
WEB_UPLOAD_SEGMENT_MODE_DEFAULT = os.getenv("WEB_UPLOAD_SEGMENT_MODE_DEFAULT", "")
WEB_WAL_CHECKPOINT_EVERY = int(os.getenv("WEB_WAL_CHECKPOINT_EVERY", "50"))
WEB_MEDIA_DIRS = os.getenv("WEB_MEDIA_DIRS", "")
WEB_MEDIA_RECURSIVE = os.getenv("WEB_MEDIA_RECURSIVE", "true").lower() == "true"
WEB_ARCHIVE_DIR = os.getenv("WEB_ARCHIVE_DIR", "")
WEB_ALLOW_DELETE = os.getenv("WEB_ALLOW_DELETE", "false").lower() == "true"
WEB_METADATA_DIR = os.getenv("WEB_METADATA_DIR", "metadata")
WEB_MEDIA_SCAN_INTERVAL = int(os.getenv("WEB_MEDIA_SCAN_INTERVAL", "0"))
WEB_TRIGGER_SCAN_INTERVAL = int(os.getenv("WEB_TRIGGER_SCAN_INTERVAL", "0"))
WEB_AUTH_ENABLED = os.getenv("WEB_AUTH_ENABLED", "false").lower() == "true"
WEB_AUTH_USER = os.getenv("WEB_AUTH_USER", "admin")
WEB_AUTH_PASSWORD = os.getenv("WEB_AUTH_PASSWORD", "")
WEB_AUTH_SECRET = os.getenv("WEB_AUTH_SECRET", "change-me")
WEB_AUTH_COOKIE = os.getenv("WEB_AUTH_COOKIE", "autosub_auth")
WEB_AUTH_TTL = int(os.getenv("WEB_AUTH_TTL", "86400"))

_wal_lock = threading.Lock()
_wal_counter = 0
_last_media_scan = 0

VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov", ".avi"}

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


def _sign_token(payload, secret):
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def build_auth_token(username):
    exp = int(time.time()) + max(60, WEB_AUTH_TTL)
    payload = f"{username}|{exp}"
    sig = _sign_token(payload, WEB_AUTH_SECRET)
    token_raw = f"{payload}|{sig}"
    return base64.urlsafe_b64encode(token_raw.encode("utf-8")).decode("utf-8")


def verify_auth_token(token):
    try:
        raw = base64.urlsafe_b64decode(token.encode("utf-8")).decode("utf-8")
    except Exception:  # noqa: BLE001
        return False
    parts = raw.split("|")
    if len(parts) != 3:
        return False
    username, exp_str, sig = parts
    payload = f"{username}|{exp_str}"
    expected = _sign_token(payload, WEB_AUTH_SECRET)
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        exp = int(exp_str)
    except ValueError:
        return False
    if exp < int(time.time()):
        return False
    return username == WEB_AUTH_USER


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


def get_upload_defaults():
    data, _entries = load_env_file(WEB_CONFIG_PATH)
    asr_mode = WEB_UPLOAD_ASR_MODE_DEFAULT or data.get("ASR_MODE", "offline")
    segment_mode = WEB_UPLOAD_SEGMENT_MODE_DEFAULT or data.get("SEGMENT_MODE", "post")
    return asr_mode, segment_mode


def get_media_dirs():
    if WEB_MEDIA_DIRS.strip():
        raw = WEB_MEDIA_DIRS
    else:
        raw = WEB_WATCH_DIRS or load_env_file(WEB_CONFIG_PATH)[0].get("WATCH_DIRS", "")
    items = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        items.append(_unquote_env_value(part))
    return items


def metadata_dir_for(video_path):
    out_dir = get_output_dir(video_path)
    if not out_dir:
        return ""
    if os.path.isabs(WEB_METADATA_DIR):
        return WEB_METADATA_DIR
    return os.path.join(out_dir, WEB_METADATA_DIR)


def metadata_path_for(video_path):
    meta_dir = metadata_dir_for(video_path)
    if not meta_dir:
        return ""
    base = os.path.splitext(os.path.basename(video_path))[0]
    return os.path.join(meta_dir, f"{base}.manual.json")


def load_manual_metadata(video_path):
    path = metadata_path_for(video_path)
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:  # noqa: BLE001
        return {}
    if isinstance(data, dict):
        return data
    return {}


def save_manual_metadata(video_path, data):
    path = metadata_path_for(video_path)
    if not path:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return True


def _read_text_file(path):
    with open(path, "rb") as f:
        data = f.read()
    if data.startswith(b"\xef\xbb\xbf"):
        return data.decode("utf-8-sig", errors="ignore")
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return data.decode("utf-16", errors="ignore")
    return data.decode("utf-8", errors="ignore")


def _write_text_file(path, content):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def get_output_dir(video_path):
    data, _entries = load_env_file(WEB_CONFIG_PATH)
    output_to_source = (data.get("OUTPUT_TO_SOURCE_DIR", "true").lower() == "true")
    if output_to_source:
        return os.path.dirname(video_path)
    return data.get("OUT_DIR", "") or os.getenv("OUT_DIR", "")


def is_safe_path(path):
    roots = []
    watch_dirs = get_watch_dirs()
    if watch_dirs:
        roots.extend(watch_dirs)
    out_dir = load_env_file(WEB_CONFIG_PATH)[0].get("OUT_DIR", "")
    if out_dir:
        roots.append(out_dir)
    abs_path = os.path.abspath(path)
    for root in roots:
        if root and abs_path.startswith(os.path.abspath(root) + os.sep):
            return True
    return False


def is_media_path(path):
    abs_path = os.path.abspath(path)
    for root in get_media_dirs():
        if root and abs_path.startswith(os.path.abspath(root) + os.sep):
            return True
    return False


def find_subtitle_candidates(video_path):
    out_dir = get_output_dir(video_path)
    if not out_dir:
        return []
    base = os.path.splitext(os.path.basename(video_path))[0]
    try:
        entries = os.listdir(out_dir)
    except FileNotFoundError:
        return []
    results = []
    for name in entries:
        if not name.lower().endswith(".srt"):
            continue
        stem = os.path.splitext(name)[0]
        if stem == base or stem.startswith(f"{base}."):
            results.append(os.path.join(out_dir, name))
    return sorted(results)


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
    try:
        os.makedirs(os.path.dirname(WEB_DB_PATH) or ".", exist_ok=True)
        conn = sqlite3.connect(WEB_DB_PATH, timeout=5)
    except OSError:
        return None
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except sqlite3.OperationalError:
        pass
    conn.execute(
        "CREATE TABLE IF NOT EXISTS jobs ("
        "id TEXT PRIMARY KEY, "
        "path TEXT NOT NULL, "
        "created_at INTEGER NOT NULL"
        ")"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS media ("
        "path TEXT PRIMARY KEY, "
        "size INTEGER NOT NULL, "
        "mtime INTEGER NOT NULL, "
        "archived INTEGER NOT NULL DEFAULT 0, "
        "label TEXT, "
        "updated_at INTEGER NOT NULL"
        ")"
    )
    conn.commit()
    return conn


def _maybe_checkpoint(conn):
    global _wal_counter
    if WEB_WAL_CHECKPOINT_EVERY <= 0:
        return
    with _wal_lock:
        _wal_counter += 1
        if _wal_counter < WEB_WAL_CHECKPOINT_EVERY:
            return
        _wal_counter = 0
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except sqlite3.OperationalError:
        return


def create_job(path):
    job_id = f"job-{int(time.time())}-{abs(hash(path)) % 100000}"
    conn = _init_db()
    if conn is None:
        return job_id
    conn.execute(
        "INSERT OR REPLACE INTO jobs (id, path, created_at) VALUES (?, ?, ?)",
        (job_id, path, int(time.time())),
    )
    conn.commit()
    _maybe_checkpoint(conn)
    conn.close()
    return job_id


def list_jobs():
    conn = _init_db()
    if conn is None:
        return []
    cur = conn.execute("SELECT id, path, created_at FROM jobs ORDER BY created_at DESC")
    rows = cur.fetchall()
    conn.close()
    return rows


def upsert_media(path):
    try:
        stat = os.stat(path)
    except OSError:
        return False
    conn = _init_db()
    if conn is None:
        return False
    cur = conn.execute("SELECT archived, label FROM media WHERE path = ?", (path,))
    row = cur.fetchone()
    archived = row[0] if row else 0
    label = row[1] if row else ""
    conn.execute(
        "INSERT OR REPLACE INTO media (path, size, mtime, archived, label, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            path,
            int(stat.st_size),
            int(stat.st_mtime),
            archived,
            label,
            int(time.time()),
        ),
    )
    conn.commit()
    _maybe_checkpoint(conn)
    conn.close()
    return True


def list_media(include_archived=True):
    conn = _init_db()
    if conn is None:
        return []
    if include_archived:
        cur = conn.execute(
            "SELECT path, size, mtime, archived, label FROM media ORDER BY mtime DESC"
        )
    else:
        cur = conn.execute(
            "SELECT path, size, mtime, archived, label FROM media WHERE archived = 0 ORDER BY mtime DESC"
        )
    rows = cur.fetchall()
    conn.close()
    return rows


def set_media_archived(path, archived):
    conn = _init_db()
    if conn is None:
        return False
    conn.execute(
        "UPDATE media SET archived = ?, updated_at = ? WHERE path = ?",
        (1 if archived else 0, int(time.time()), path),
    )
    conn.commit()
    _maybe_checkpoint(conn)
    conn.close()
    return True


def delete_media(path, delete_file=False):
    if delete_file:
        if not (is_safe_path(path) or is_media_path(path)):
            return False
        try:
            os.remove(path)
        except OSError:
            return False
    conn = _init_db()
    if conn is None:
        return False
    conn.execute("DELETE FROM media WHERE path = ?", (path,))
    conn.commit()
    _maybe_checkpoint(conn)
    conn.close()
    return True


def scan_media():
    media_dirs = get_media_dirs()
    if not media_dirs:
        return 0
    count = 0
    for base in media_dirs:
        if not os.path.exists(base):
            continue
        if WEB_MEDIA_RECURSIVE:
            walker = os.walk(base)
            for root, _dirs, files in walker:
                for name in files:
                    if os.path.splitext(name)[1].lower() not in VIDEO_EXTS:
                        continue
                    path = os.path.join(root, name)
                    if upsert_media(path):
                        count += 1
        else:
            try:
                entries = os.listdir(base)
            except OSError:
                continue
            for name in entries:
                path = os.path.join(base, name)
                if not os.path.isfile(path):
                    continue
                if os.path.splitext(name)[1].lower() not in VIDEO_EXTS:
                    continue
                if upsert_media(path):
                    count += 1
    return count


def _media_scan_loop():
    global _last_media_scan
    interval = WEB_MEDIA_SCAN_INTERVAL
    if interval <= 0:
        return
    while True:
        try:
            count = scan_media()
            _last_media_scan = int(time.time())
            if count:
                print(f"[web] media scan updated {count} files", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"[web] media scan failed: {exc}", flush=True)
        time.sleep(interval)


def _trigger_scan_loop():
    interval = WEB_TRIGGER_SCAN_INTERVAL
    if interval <= 0:
        return
    while True:
        try:
            trigger_scan()
        except Exception as exc:  # noqa: BLE001
            print(f"[web] trigger scan failed: {exc}", flush=True)
        time.sleep(interval)


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


def load_job_meta(path):
    base = os.path.splitext(os.path.basename(path))[0]
    meta_path = os.path.join(os.path.dirname(path), f"{base}.job.json")
    if not os.path.exists(meta_path):
        return {}
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:  # noqa: BLE001
        return {}
    if isinstance(data, dict):
        return data
    return {}


def trigger_scan():
    watch_dirs = get_watch_dirs()
    if not watch_dirs:
        return False, "未配置 WATCH_DIRS"
    if not WEB_TRIGGER_SCAN_FILE:
        return False, "未配置触发文件名"
    last_error = ""
    ok = False
    for base in watch_dirs:
        os.makedirs(base, exist_ok=True)
        path = os.path.join(base, WEB_TRIGGER_SCAN_FILE)
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write("scan")
            ok = True
        except OSError as exc:
            last_error = str(exc)
    if ok:
        return True, ""
    return False, last_error or "触发失败"


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
      <a href="/media">媒体库</a>
      <a href="/logout">退出</a>
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


def render_jobs(jobs, message="", keyword=""):
    search_form = (
        "<form method=\"get\" style=\"margin-bottom: 12px;\">"
        f"<input name=\"q\" placeholder=\"搜索路径\" value=\"{html.escape(keyword)}\" />"
        "<button type=\"submit\">搜索</button>"
        "</form>"
    )
    search_form = (
        "<form method=\"get\" style=\"margin-bottom: 12px;\">"
        "<input name=\"q\" placeholder=\"搜索路径\" />"
        "<button type=\"submit\">搜索</button>"
        "</form>"
    )
    rows = []
    for job_id, path, created_at in jobs:
        status = infer_job_status(path)
        meta = load_job_meta(path)
        asr_mode = str(meta.get("asr_mode", ""))
        segment_mode = str(meta.get("segment_mode", ""))
        created = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(created_at))
        subtitle_link = f"<a href=\"/subtitle?video={quote(path)}\">查看</a>"
        rows.append(
            "<tr>"
            f"<td>{html.escape(job_id)}</td>"
            f"<td>{html.escape(path)}</td>"
            f"<td>{html.escape(status)}</td>"
            f"<td>{html.escape(asr_mode)}</td>"
            f"<td>{html.escape(segment_mode)}</td>"
            f"<td>{subtitle_link}</td>"
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
      <a href="/media">媒体库</a>
      <a href="/logout">退出</a>
    </nav>
    <h1>任务列表</h1>
    {notice}
    {search_form}
    <form method="post" action="/scan" style="margin-bottom: 12px;">
      <button type="submit">触发扫描</button>
    </form>
    <div style="margin-bottom: 12px;">
      <a href="/export/jobs?format=json">导出 JSON</a>
      <a href="/export/jobs?format=csv" style="margin-left:6px;">导出 CSV</a>
    </div>
    <table>
      <thead>
        <tr><th>任务 ID</th><th>路径</th><th>状态</th><th>ASR</th><th>切片</th><th>字幕</th><th>创建时间</th></tr>
      </thead>
      <tbody>
        {rows_html}
      </tbody>
    </table>
  </main>
</body>
</html>
"""


def render_upload(message="", asr_mode="", segment_mode=""):
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
    form {{ background: #fff8ef; padding: 18px; border: 1px solid #e4d8c8; border-radius: 14px; display: grid; gap: 12px; }}
    nav a {{ margin-right: 12px; color: #c65d31; text-decoration: none; }}
    input[type=file] {{ margin: 12px 0; }}
    select {{ padding: 8px 10px; border-radius: 8px; border: 1px solid #e4d8c8; }}
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
      <a href="/media">媒体库</a>
      <a href="/logout">退出</a>
    </nav>
    <h1>上传媒体</h1>
    {notice}
    <form method="post" enctype="multipart/form-data">
      <label>ASR 模式</label>
      <select name="asr_mode">
        <option value="offline" {"selected" if asr_mode == "offline" else ""}>offline</option>
        <option value="realtime" {"selected" if asr_mode == "realtime" else ""}>realtime</option>
      </select>
      <label>切片模式</label>
      <select name="segment_mode">
        <option value="post" {"selected" if segment_mode == "post" else ""}>post</option>
        <option value="auto" {"selected" if segment_mode == "auto" else ""}>auto</option>
      </select>
      <input type="file" name="file" />
      <button type="submit">上传并创建任务</button>
    </form>
  </main>
</body>
</html>
"""


def render_login(message=""):
    notice = f"<div class='notice'>{html.escape(message)}</div>" if message else ""
    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>登录</title>
  <style>
    body {{ font-family: "IBM Plex Serif", serif; background: #f7f4ef; color: #1f1c18; }}
    main {{ max-width: 520px; margin: 0 auto; padding: 48px 24px; }}
    form {{ background: #fff8ef; padding: 18px; border: 1px solid #e4d8c8; border-radius: 14px; display: grid; gap: 10px; }}
    input {{ padding: 8px 10px; border-radius: 8px; border: 1px solid #e4d8c8; }}
    button {{ border: none; border-radius: 999px; padding: 8px 16px; background: #c65d31; color: #fff; }}
    .notice {{ background: #fff1d9; border: 1px solid #e4d8c8; padding: 10px 12px; border-radius: 10px; }}
  </style>
</head>
<body>
  <main>
    <h1>登录</h1>
    {notice}
    <form method="post" action="/login">
      <label>用户名</label>
      <input name="username" />
      <label>密码</label>
      <input name="password" type="password" />
      <button type="submit">登录</button>
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
      <a href="/media">媒体库</a>
      <a href="/logout">退出</a>
    </nav>
    <h1>日志</h1>
    <form method="get">
      <input name="q" placeholder="关键词" value="{html.escape(keyword)}" />
      <input name="limit" placeholder="条数" value="{html.escape(str(limit))}" />
      <button type="submit">筛选</button>
      <a href="/export/logs?format=json&q={quote(keyword)}&limit={limit}">导出 JSON</a>
      <a href="/export/logs?format=csv&q={quote(keyword)}&limit={limit}">导出 CSV</a>
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


def render_subtitle_editor(video_path, subtitle_path, content, candidates, message=""):
    notice = f"<div class='notice'>{html.escape(message)}</div>" if message else ""
    links = []
    for path in candidates:
        label = os.path.basename(path)
        links.append(
            f"<a href=\"/subtitle?path={quote(path)}&video={quote(video_path)}\">{html.escape(label)}</a>"
        )
    link_html = " | ".join(links) if links else "暂无字幕文件"
    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>字幕编辑</title>
  <style>
    body {{ font-family: "IBM Plex Serif", serif; background: #f7f4ef; color: #1f1c18; }}
    main {{ max-width: 1100px; margin: 0 auto; padding: 24px; }}
    nav a {{ margin-right: 12px; color: #c65d31; text-decoration: none; }}
    textarea {{ width: 100%; min-height: 480px; padding: 12px; border-radius: 12px; border: 1px solid #e4d8c8; }}
    button {{ border: none; border-radius: 999px; padding: 8px 16px; background: #c65d31; color: #fff; }}
    .notice {{ background: #fff1d9; border: 1px solid #e4d8c8; padding: 10px 12px; border-radius: 10px; }}
    .meta {{ color: #6f655a; font-size: 12px; margin: 8px 0 12px; }}
  </style>
</head>
<body>
  <main>
    <nav>
      <a href="/">设置</a>
      <a href="/upload">上传</a>
      <a href="/jobs">任务</a>
      <a href="/logs">日志</a>
      <a href="/media">媒体库</a>
      <a href="/logout">退出</a>
    </nav>
    <h1>字幕编辑</h1>
    {notice}
    <div class="meta">视频：{html.escape(video_path)}</div>
    <div class="meta">当前字幕：{html.escape(subtitle_path)}</div>
    <div class="meta">可选字幕：{link_html}</div>
    <form method="post">
      <input type="hidden" name="path" value="{html.escape(subtitle_path)}" />
      <textarea name="content">{html.escape(content)}</textarea>
      <div style="margin-top: 12px;">
        <button type="submit">保存字幕</button>
      </div>
    </form>
  </main>
</body>
</html>
"""


def render_media(media_rows, message="", keyword=""):
    last_scan = (
        time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(_last_media_scan))
        if _last_media_scan
        else "未扫描"
    )
    rows = []
    for path, size, mtime, archived, label in media_rows:
        status = "archived" if archived else "active"
        size_mb = round(size / 1024 / 1024, 2)
        mtime_text = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(mtime))
        action = "unarchive" if archived else "archive"
        action_label = "取消归档" if archived else "归档"
        rows.append(
            "<tr>"
            f"<td>{html.escape(path)}</td>"
            f"<td>{size_mb} MB</td>"
            f"<td>{html.escape(status)}</td>"
            f"<td>{html.escape(mtime_text)}</td>"
            f"<td><a href=\"/metadata?path={quote(path)}\">元数据</a></td>"
            f"<td>"
            f"<form method=\"post\" style=\"display:inline\">"
            f"<input type=\"hidden\" name=\"path\" value=\"{html.escape(path)}\"/>"
            f"<input type=\"hidden\" name=\"action\" value=\"{action}\"/>"
            f"<button type=\"submit\">{action_label}</button>"
            f"</form>"
            f"</td>"
            f"<td>"
            f"<form method=\"post\" style=\"display:inline\">"
            f"<input type=\"hidden\" name=\"path\" value=\"{html.escape(path)}\"/>"
            f"<input type=\"hidden\" name=\"action\" value=\"delete\"/>"
            f"<button type=\"submit\">删除</button>"
            f"</form>"
            f"</td>"
            "</tr>"
        )
    rows_html = "\n".join(rows) if rows else "<tr><td colspan='7'>暂无媒体</td></tr>"
    notice = f"<div class='notice'>{html.escape(message)}</div>" if message else ""
    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>媒体库</title>
  <style>
    body {{ font-family: "IBM Plex Serif", serif; background: #f7f4ef; color: #1f1c18; }}
    main {{ max-width: 1200px; margin: 0 auto; padding: 24px; }}
    table {{ width: 100%; border-collapse: collapse; background: #fff8ef; }}
    th, td {{ border: 1px solid #e4d8c8; padding: 8px; text-align: left; }}
    th {{ background: #f0e2d2; }}
    nav a {{ margin-right: 12px; color: #c65d31; text-decoration: none; }}
    .notice {{ background: #fff1d9; border: 1px solid #e4d8c8; padding: 10px 12px; border-radius: 10px; }}
    .actions {{ margin-bottom: 12px; }}
    button {{ border: none; border-radius: 999px; padding: 6px 12px; background: #c65d31; color: #fff; }}
  </style>
</head>
<body>
  <main>
    <nav>
      <a href="/">设置</a>
      <a href="/upload">上传</a>
      <a href="/jobs">任务</a>
      <a href="/logs">日志</a>
      <a href="/media">媒体库</a>
    </nav>
    <h1>媒体库</h1>
    {notice}
    <div class="actions">
      <div style="display:inline-block;margin-right:12px;color:#6f655a;">最近扫描：{html.escape(last_scan)}</div>
      <form method="post" style="display:inline">
        <input type="hidden" name="action" value="scan"/>
        <button type="submit">扫描媒体</button>
      </form>
      <form method="get" style="display:inline;margin-left:12px;">
        <input name="q" placeholder="搜索路径" value="{html.escape(keyword)}" />
        <button type="submit">搜索</button>
      </form>
      <a style="margin-left:12px;" href="/export/media?format=json">导出 JSON</a>
      <a style="margin-left:6px;" href="/export/media?format=csv">导出 CSV</a>
    </div>
    <table>
      <thead>
        <tr><th>路径</th><th>大小</th><th>状态</th><th>更新时间</th><th>元数据</th><th>归档</th><th>删除</th></tr>
      </thead>
      <tbody>
        {rows_html}
      </tbody>
    </table>
  </main>
</body>
</html>
"""


def render_metadata_editor(video_path, meta, message=""):
    notice = f"<div class='notice'>{html.escape(message)}</div>" if message else ""
    title_original = meta.get("title_original", "")
    title_zh = meta.get("title_localized", {}).get("zh-CN", "")
    title_en = meta.get("title_localized", {}).get("en-US", "")
    season = meta.get("season", "")
    episode = meta.get("episode", "")
    year = meta.get("year", "")
    work_type = meta.get("type", "")
    episode_title_zh = meta.get("episode_title", {}).get("zh-CN", "")
    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>元数据</title>
  <style>
    body {{ font-family: "IBM Plex Serif", serif; background: #f7f4ef; color: #1f1c18; }}
    main {{ max-width: 900px; margin: 0 auto; padding: 24px; }}
    nav a {{ margin-right: 12px; color: #c65d31; text-decoration: none; }}
    form {{ background: #fff8ef; padding: 18px; border: 1px solid #e4d8c8; border-radius: 14px; display: grid; gap: 10px; }}
    input {{ padding: 8px 10px; border-radius: 8px; border: 1px solid #e4d8c8; }}
    button {{ border: none; border-radius: 999px; padding: 8px 16px; background: #c65d31; color: #fff; }}
    .notice {{ background: #fff1d9; border: 1px solid #e4d8c8; padding: 10px 12px; border-radius: 10px; }}
  </style>
</head>
<body>
  <main>
    <nav>
      <a href="/">设置</a>
      <a href="/media">媒体库</a>
    </nav>
    <h1>元数据</h1>
    {notice}
    <div style="color:#6f655a;font-size:12px;">{html.escape(video_path)}</div>
    <form method="post">
      <input type="hidden" name="path" value="{html.escape(video_path)}"/>
      <label>原始标题</label>
      <input name="title_original" value="{html.escape(str(title_original))}"/>
      <label>简体标题</label>
      <input name="title_zh" value="{html.escape(str(title_zh))}"/>
      <label>英文标题</label>
      <input name="title_en" value="{html.escape(str(title_en))}"/>
      <label>类型</label>
      <input name="type" value="{html.escape(str(work_type))}"/>
      <label>年份</label>
      <input name="year" value="{html.escape(str(year))}"/>
      <label>季</label>
      <input name="season" value="{html.escape(str(season))}"/>
      <label>集</label>
      <input name="episode" value="{html.escape(str(episode))}"/>
      <label>集标题（简体）</label>
      <input name="episode_title_zh" value="{html.escape(str(episode_title_zh))}"/>
      <button type="submit">保存元数据</button>
    </form>
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

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def _get_cookie(self):
        cookie = self.headers.get("Cookie", "")
        for item in cookie.split(";"):
            item = item.strip()
            if not item:
                continue
            if item.startswith(WEB_AUTH_COOKIE + "="):
                return item.split("=", 1)[1]
        return ""

    def _is_authed(self):
        if not WEB_AUTH_ENABLED:
            return True
        token = self._get_cookie()
        if not token:
            return False
        return verify_auth_token(token)

    def _require_auth(self):
        if self._is_authed():
            return False
        self._send_html(render_login("请先登录"), status=401)
        return True

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/login":
            return self._send_html(render_login())
        if self._require_auth():
            return
        if path == "/jobs":
            keyword = (parse_qs(parsed.query).get("q") or [""])[0].strip()
            jobs = list_jobs()
            if keyword:
                jobs = [job for job in jobs if keyword in job[1]]
            page = render_jobs(jobs, keyword=keyword)
            return self._send_html(page)
        if path == "/upload":
            asr_mode, segment_mode = get_upload_defaults()
            page = render_upload(asr_mode=asr_mode, segment_mode=segment_mode)
            return self._send_html(page)
        if path == "/logs":
            return self._handle_logs()
        if path == "/subtitle":
            return self._handle_subtitle()
        if path == "/media":
            keyword = (parse_qs(parsed.query).get("q") or [""])[0].strip()
            rows = list_media()
            if keyword:
                rows = [row for row in rows if keyword in row[0]]
            return self._send_html(render_media(rows, keyword=keyword))
        if path == "/metadata":
            return self._handle_metadata()
        if path == "/export/logs":
            return self._handle_export_logs(parsed)
        if path == "/export/jobs":
            return self._handle_export_jobs(parsed)
        if path == "/export/media":
            return self._handle_export_media(parsed)
        values, _entries = load_env_file(WEB_CONFIG_PATH)
        sections = load_schema(WEB_SCHEMA_PATH)
        page = render_page(values, sections)
        self._send_html(page)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/login":
            length = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(length).decode("utf-8")
            params = parse_qs(data, keep_blank_values=True)
            username = (params.get("username") or [""])[0]
            password = (params.get("password") or [""])[0]
            if username == WEB_AUTH_USER and password == WEB_AUTH_PASSWORD:
                token = build_auth_token(username)
                self.send_response(302)
                self.send_header("Set-Cookie", f"{WEB_AUTH_COOKIE}={token}; HttpOnly; Path=/")
                self.send_header("Location", "/")
                self.end_headers()
                return
            return self._send_html(render_login("用户名或密码错误"), status=401)
        if path == "/logout":
            self.send_response(302)
            self.send_header("Set-Cookie", f"{WEB_AUTH_COOKIE}=; Max-Age=0; Path=/")
            self.send_header("Location", "/login")
            self.end_headers()
            return
        if self._require_auth():
            return
        if path == "/upload":
            return self._handle_upload()
        if path == "/scan":
            ok, reason = trigger_scan()
            jobs = list_jobs()
            if ok:
                message = "已触发扫描"
            else:
                message = f"触发失败：{reason}"
            page = render_jobs(jobs, message=message)
            return self._send_html(page)
        if path == "/logs":
            return self._handle_logs(post=True)
        if path == "/subtitle":
            return self._handle_subtitle(post=True)
        if path == "/media":
            return self._handle_media()
        if path == "/metadata":
            return self._handle_metadata(post=True)
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
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > max_bytes:
            return self._send_html(render_upload("文件过大"), status=413)
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            asr_mode, segment_mode = get_upload_defaults()
            return self._send_html(render_upload("不支持的上传类型", asr_mode, segment_mode), status=400)
        raw = self.rfile.read(content_length)
        header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
        message = BytesParser(policy=policy.default).parsebytes(header + raw)
        file_info = None
        fields = {}
        for part in message.iter_parts():
            disp = part.get("Content-Disposition", "")
            if "form-data" not in disp:
                continue
            name = part.get_param("name", header="content-disposition")
            filename = part.get_filename()
            if filename:
                payload = part.get_payload(decode=True) or b""
                file_info = (filename, payload)
            elif name:
                fields[name] = part.get_content()
        if not file_info:
            asr_mode, segment_mode = get_upload_defaults()
            return self._send_html(render_upload("请选择文件", asr_mode, segment_mode))

        watch_dirs = get_watch_dirs()
        target_dir = WEB_UPLOAD_DIR or (watch_dirs[0] if watch_dirs else "")
        if not target_dir:
            asr_mode, segment_mode = get_upload_defaults()
            return self._send_html(render_upload("未配置上传目录", asr_mode, segment_mode))
        os.makedirs(target_dir, exist_ok=True)
        filename = os.path.basename(file_info[0])
        dest_path = os.path.join(target_dir, filename)
        if os.path.exists(dest_path) and not WEB_UPLOAD_OVERWRITE:
            asr_mode, segment_mode = get_upload_defaults()
            return self._send_html(render_upload("文件已存在", asr_mode, segment_mode))
        with open(dest_path, "wb") as f:
            f.write(file_info[1])
        asr_mode = (fields.get("asr_mode") or get_upload_defaults()[0]).strip()
        segment_mode = (fields.get("segment_mode") or get_upload_defaults()[1]).strip()
        meta_path = os.path.join(
            target_dir,
            f"{os.path.splitext(filename)[0]}.job.json",
        )
        meta = {
            "asr_mode": asr_mode,
            "segment_mode": segment_mode,
            "created_at": int(time.time()),
        }
        try:
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
        except OSError:
            pass
        job_id = create_job(dest_path)
        return self._send_html(
            render_upload(f"上传成功，任务 {job_id} 已创建", asr_mode, segment_mode)
        )

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

    def _handle_subtitle(self, post=False):
        if post:
            length = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(length).decode("utf-8")
            params = parse_qs(data, keep_blank_values=True)
        else:
            params = parse_qs(urlparse(self.path).query, keep_blank_values=True)
        video_path = (params.get("video") or [""])[0]
        subtitle_path = (params.get("path") or [""])[0]
        candidates = []
        if video_path:
            candidates = find_subtitle_candidates(video_path)
            if not subtitle_path and candidates:
                subtitle_path = candidates[0]
        if not subtitle_path or not is_safe_path(subtitle_path):
            page = render_subtitle_editor(
                video_path,
                subtitle_path or "",
                "",
                candidates,
                message="字幕路径不可用",
            )
            return self._send_html(page, status=400)
        if post:
            content = (params.get("content") or [""])[0]
            try:
                srt.parse(content)
            except Exception:  # noqa: BLE001
                page = render_subtitle_editor(
                    video_path,
                    subtitle_path,
                    content,
                    candidates,
                    message="SRT 格式可能有误，请检查",
                )
                return self._send_html(page, status=400)
            if os.path.exists(subtitle_path):
                ts = time.strftime("%Y%m%d%H%M%S", time.localtime())
                backup = f"{subtitle_path}.bak.{ts}"
                try:
                    os.replace(subtitle_path, backup)
                except OSError:
                    pass
            _write_text_file(subtitle_path, content)
            page = render_subtitle_editor(
                video_path,
                subtitle_path,
                content,
                candidates,
                message="保存成功",
            )
            return self._send_html(page)
        content = _read_text_file(subtitle_path) if os.path.exists(subtitle_path) else ""
        page = render_subtitle_editor(video_path, subtitle_path, content, candidates)
        return self._send_html(page)

    def _handle_media(self):
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length).decode("utf-8")
        params = parse_qs(data, keep_blank_values=True)
        action = (params.get("action") or [""])[0]
        path = (params.get("path") or [""])[0]
        message = ""
        if action == "scan":
            count = scan_media()
            message = f"已扫描 {count} 个媒体"
        elif action in {"archive", "unarchive"} and path:
            if not is_media_path(path):
                message = "路径不在媒体目录"
                rows = list_media()
                return self._send_html(render_media(rows, message=message), status=400)
            archived = action == "archive"
            if archived and WEB_ARCHIVE_DIR:
                try:
                    os.makedirs(WEB_ARCHIVE_DIR, exist_ok=True)
                    dest = os.path.join(WEB_ARCHIVE_DIR, os.path.basename(path))
                    os.replace(path, dest)
                    delete_media(path, delete_file=False)
                    upsert_media(dest)
                    set_media_archived(dest, True)
                    message = "已归档并移动文件"
                except OSError:
                    message = "归档失败"
            else:
                set_media_archived(path, archived)
                message = "已更新状态"
        elif action == "delete" and path:
            if not WEB_ALLOW_DELETE:
                message = "未启用删除权限"
            else:
                ok = delete_media(path, delete_file=True)
                message = "已删除" if ok else "删除失败"
        rows = list_media()
        return self._send_html(render_media(rows, message=message))

    def _handle_metadata(self, post=False):
        if post:
            length = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(length).decode("utf-8")
            params = parse_qs(data, keep_blank_values=True)
        else:
            params = parse_qs(urlparse(self.path).query, keep_blank_values=True)
        video_path = (params.get("path") or [""])[0]
        if not video_path:
            return self._send_html(render_metadata_editor("", {}, message="缺少路径"), status=400)
        meta = load_manual_metadata(video_path)
        if post:
            title_original = (params.get("title_original") or [""])[0].strip()
            title_zh = (params.get("title_zh") or [""])[0].strip()
            title_en = (params.get("title_en") or [""])[0].strip()
            work_type = (params.get("type") or [""])[0].strip()
            year = (params.get("year") or [""])[0].strip()
            season = (params.get("season") or [""])[0].strip()
            episode = (params.get("episode") or [""])[0].strip()
            episode_title_zh = (params.get("episode_title_zh") or [""])[0].strip()
            meta = {
                "title_original": title_original or None,
                "title_localized": {
                    "zh-CN": title_zh,
                    "en-US": title_en,
                },
                "type": work_type or None,
                "year": int(year) if year.isdigit() else None,
                "season": int(season) if season.isdigit() else None,
                "episode": int(episode) if episode.isdigit() else None,
                "episode_title": {"zh-CN": episode_title_zh} if episode_title_zh else {},
                "external_ids": {},
                "characters": [],
            }
            saved = save_manual_metadata(video_path, meta)
            message = "已保存" if saved else "保存失败"
            return self._send_html(render_metadata_editor(video_path, meta, message=message))
        return self._send_html(render_metadata_editor(video_path, meta))

    def _handle_export_logs(self, parsed):
        params = parse_qs(parsed.query, keep_blank_values=True)
        keyword = (params.get("q") or [""])[0].strip()
        limit_raw = (params.get("limit") or [""])[0].strip()
        fmt = (params.get("format") or ["json"])[0].strip().lower()
        limit = WEB_LOG_LIMIT
        if limit_raw.isdigit():
            limit = max(1, min(5000, int(limit_raw)))
        logs = read_logs(keyword=keyword, limit=limit)
        return self._send_export("logs", logs, fmt)

    def _handle_export_jobs(self, parsed):
        params = parse_qs(parsed.query, keep_blank_values=True)
        fmt = (params.get("format") or ["json"])[0].strip().lower()
        jobs = list_jobs()
        rows = []
        for job_id, path, created_at in jobs:
            status = infer_job_status(path)
            meta = load_job_meta(path)
            rows.append(
                {
                    "id": job_id,
                    "path": path,
                    "status": status,
                    "asr_mode": meta.get("asr_mode"),
                    "segment_mode": meta.get("segment_mode"),
                    "created_at": created_at,
                }
            )
        return self._send_export("jobs", rows, fmt)

    def _handle_export_media(self, parsed):
        params = parse_qs(parsed.query, keep_blank_values=True)
        fmt = (params.get("format") or ["json"])[0].strip().lower()
        rows = list_media()
        items = []
        for path, size, mtime, archived, label in rows:
            items.append(
                {
                    "path": path,
                    "size": size,
                    "mtime": mtime,
                    "archived": archived,
                    "label": label,
                }
            )
        return self._send_export("media", items, fmt)

    def _send_export(self, name, items, fmt):
        if fmt == "csv":
            return self._send_csv(name, items)
        return self._send_json(name, items)

    def _send_json(self, name, items):
        data = json.dumps(items, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Disposition", f"attachment; filename={name}.json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_csv(self, name, items):
        if not items:
            body = ""
        else:
            keys = list(items[0].keys()) if isinstance(items[0], dict) else ["value"]
            rows = [",".join(keys)]
            for item in items:
                if isinstance(item, dict):
                    row = [str(item.get(k, "")).replace("\n", " ").replace(",", " ") for k in keys]
                else:
                    row = [str(item).replace("\n", " ").replace(",", " ")]
                rows.append(",".join(row))
            body = "\n".join(rows)
        data = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f"attachment; filename={name}.csv")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        return None


def main():
    server = ThreadingHTTPServer((WEB_HOST, WEB_PORT), SettingsHandler)
    print(f"[web] listening on http://{WEB_HOST}:{WEB_PORT}")
    if WEB_MEDIA_SCAN_INTERVAL > 0:
        threading.Thread(target=_media_scan_loop, daemon=True).start()
    if WEB_TRIGGER_SCAN_INTERVAL > 0:
        threading.Thread(target=_trigger_scan_loop, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
