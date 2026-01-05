import hashlib
import json
import os
import queue
import re
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
from typing import Callable, NamedTuple, Optional

import dashscope
import oss2
import requests
import srt
import yaml
from dashscope.audio.asr import Transcription

VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov", ".avi"}
MIN_BYTES = 1 * 1024 * 1024

WATCH_DIR = os.getenv("WATCH_DIR", "/watch")
OUT_DIR = os.getenv("OUT_DIR", "/output")
TMP_DIR = os.getenv("TMP_DIR", "/tmp")
SCAN_INTERVAL = int(os.getenv("SCAN_INTERVAL", "300"))
LOCK_TTL = int(os.getenv("LOCK_TTL", "7200"))

DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
ASR_MODEL = os.getenv("ASR_MODEL", "paraformer-v2")
LANGUAGE_HINTS = [h.strip() for h in os.getenv("LANGUAGE_HINTS", "ja,en").split(",") if h.strip()]

OSS_ENDPOINT = os.getenv("OSS_ENDPOINT", "")
OSS_BUCKET = os.getenv("OSS_BUCKET", "")
OSS_ACCESS_KEY_ID = os.getenv("OSS_ACCESS_KEY_ID", "")
OSS_ACCESS_KEY_SECRET = os.getenv("OSS_ACCESS_KEY_SECRET", "")
OSS_PREFIX = os.getenv("OSS_PREFIX", "subtitle-audio/")
OSS_URL_MODE = os.getenv("OSS_URL_MODE", "presign")
OSS_PRESIGN_EXPIRE = int(os.getenv("OSS_PRESIGN_EXPIRE", "86400"))
DELETE_OSS_OBJECT = os.getenv("DELETE_OSS_OBJECT", "false").lower() == "true"

SAVE_RAW_JSON = os.getenv("SAVE_RAW_JSON", "false").lower() == "true"
MOVE_DONE = os.getenv("MOVE_DONE", "false").lower() == "true"
DONE_DIR = os.getenv("DONE_DIR", "/watch/done")
OUTPUT_LANG_SUFFIX = os.getenv("OUTPUT_LANG_SUFFIX", "").strip()
if OUTPUT_LANG_SUFFIX and not OUTPUT_LANG_SUFFIX.startswith("."):
    OUTPUT_LANG_SUFFIX = f".{OUTPUT_LANG_SUFFIX}"

TRANSLATE = os.getenv("TRANSLATE", "true").lower() == "true"
SRC_LANG = os.getenv("SRC_LANG", "auto").strip()
DST_LANG = os.getenv("DST_LANG", "zh").strip()
_DST_LANGS = os.getenv("DST_LANGS", "").strip()
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "").strip()
LLM_API_KEY = os.getenv("LLM_API_KEY", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-v3.2").strip()
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1024"))
BATCH_LINES = int(os.getenv("BATCH_LINES", "10"))
MAX_CONCURRENT_TRANSLATIONS = int(os.getenv("MAX_CONCURRENT_TRANSLATIONS", "2"))
TRANSLATE_RETRY = int(os.getenv("TRANSLATE_RETRY", "3"))
MAX_CHARS_PER_LINE = int(os.getenv("MAX_CHARS_PER_LINE", "20"))
BILINGUAL = os.getenv("BILINGUAL", "false").lower() == "true"
BILINGUAL_ORDER = os.getenv("BILINGUAL_ORDER", "raw_first").strip()
BILINGUAL_LANG = os.getenv("BILINGUAL_LANG", "").strip()
USE_POLISH = os.getenv("USE_POLISH", "false").lower() == "true"
POLISH_BATCH_SIZE = int(os.getenv("POLISH_BATCH_SIZE", "80"))
GLOSSARY_PATH = os.getenv("GLOSSARY_PATH", "").strip()
GLOSSARY_CONFIDENCE_THRESHOLD = float(os.getenv("GLOSSARY_CONFIDENCE_THRESHOLD", "0.75"))

CACHE_DIR = os.path.join(OUT_DIR, "cache")
CACHE_DB = os.path.join(CACHE_DIR, "translate_cache.db")


class WorkInfo(NamedTuple):
    title: Optional[str]
    season: Optional[str]
    episode: Optional[str]
    confidence: float
    source: str


def parse_langs():
    if _DST_LANGS:
        langs = [lang.strip() for lang in _DST_LANGS.split(",") if lang.strip()]
    else:
        langs = [DST_LANG] if DST_LANG else []
    seen = []
    for lang in langs:
        if lang not in seen:
            seen.append(lang)
    return seen


def _clean_title(text):
    if not text:
        return ""
    cleaned = text
    cleaned = re.sub(r"\[[^\]]*\]", " ", cleaned)
    cleaned = re.sub(r"\([^\)]*\)", " ", cleaned)
    cleaned = re.sub(r"\b(1080p|720p|2160p|4k|x264|x265|hevc|h264|h265)\b", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(web[- ]?dl|webrip|bdrip|hdrip|bluray|aac|flac|dts)\b", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(s\d{1,2}e\d{1,3})\b", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"[_\.]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def guess_work_info_from_path(path):
    filename = os.path.basename(path)
    name = os.path.splitext(filename)[0]
    season = None
    episode = None
    confidence = 0.1

    sxe = re.search(r"[sS](\d{1,2})\s*[eE](\d{1,3})", name)
    if sxe:
        season = str(int(sxe.group(1)))
        episode = str(int(sxe.group(2)))
        confidence = max(confidence, 0.35)
    else:
        ep_match = re.search(r"(?:^|[\\s._-])(?:ep|episode)?\\s*(\\d{1,4})(?:$|[\\s._-])", name, re.I)
        if ep_match:
            episode = str(int(ep_match.group(1)))
            confidence = max(confidence, 0.25)

    title_candidate = _clean_title(name)
    if title_candidate:
        title = title_candidate
        confidence = max(confidence, 0.2)
    else:
        title = None

    if title or season or episode:
        return WorkInfo(title=title, season=season, episode=episode, confidence=min(confidence, 0.5), source="path_only")
    return WorkInfo(title=None, season=None, episode=None, confidence=0.0, source="none")


def load_glossary_from_yaml(path):
    if not path:
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not isinstance(data, dict):
            return {}
        return data
    except FileNotFoundError:
        return {}
    except Exception:  # noqa: BLE001
        return {}


def _normalize_title(value):
    return re.sub(r"\s+", "", value or "").lower()


def build_effective_glossary(raw_glossary, work_info, confidence_threshold=0.75):
    try:
        if not isinstance(raw_glossary, dict) or not raw_glossary:
            return {}
        glossary = {}
        global_terms = raw_glossary.get("global", {}) or {}
        if isinstance(global_terms, dict):
            glossary.update(global_terms)
        if (
            work_info
            and work_info.title
            and work_info.confidence >= confidence_threshold
        ):
            works = raw_glossary.get("works", {}) or {}
            if isinstance(works, dict):
                title_key = _normalize_title(work_info.title)
                for key, mapping in works.items():
                    if not isinstance(mapping, dict):
                        continue
                    if _normalize_title(key) in title_key:
                        glossary.update(mapping)
                        break
        return glossary
    except Exception:  # noqa: BLE001
        return {}


def format_glossary(glossary):
    if not glossary:
        return (
            "当前没有可用术语表。遇到专有名词时："
            "优先音译或保留原文，不要随意意译，"
            "在不确定作品的情况下不要假设属于某个具体作品。"
        )
    items = []
    for key in sorted(glossary.keys()):
        value = glossary[key]
        items.append(f"{key} => {value}")
    return "固定术语表（如出现这些原文，请务必翻成右侧词语）：\n" + "\n".join(items)


def refine_work_info_via_llm(path_info, sample_lines, llm_client, path=""):
    lines = [line for line in sample_lines if line.strip()][:30]
    system_prompt = (
        "你是一个负责识别影视作品信息的助手。"
        "你会得到：字幕文件路径与若干台词示例。"
        "请尽量推断作品标题、季/篇章、集数；不确定则降低置信度。"
        "回答必须是严格 JSON，不要解释。"
    )
    user_prompt = (
        "现有基于路径的初步推断（可能不可靠）：\n"
        f"title = {json.dumps(path_info.title, ensure_ascii=False)}\n"
        f"season = {json.dumps(path_info.season, ensure_ascii=False)}\n"
        f"episode = {json.dumps(path_info.episode, ensure_ascii=False)}\n"
        f"confidence = {path_info.confidence}\n\n"
        "字幕文件路径：\n"
        f"{path}\n\n"
        "以下是字幕中的部分台词示例（可能是日文、英文等）：\n"
        + "\n".join(lines)
        + "\n\n"
        "请你综合路径信息和字幕内容，输出一个 JSON，字段如下：\n"
        '{\n  "title": string 或 null,\n  "season": string 或 null,\n  "episode": string 或 null,\n  "confidence": 0.0~1.0 的数字\n}\n\n'
        "注意：\n"
        "1. 如果你无法确定作品，请将 title 设为 null，confidence 设为 0.0~0.3。\n"
        "2. 如果你只是“有一点点猜测”，confidence 不要超过 0.6。\n"
        "3. 只有在你非常有把握时，才可以把 confidence 调到 0.7~0.9。\n"
        "4. 不要输出注释或额外文本，只要 JSON。"
    )
    prompt = f"[system]\n{system_prompt}\n\n[user]\n{user_prompt}"
    raw = llm_client(prompt)
    try:
        data = json.loads(raw)
    except Exception:  # noqa: BLE001
        return WorkInfo(
            title=path_info.title,
            season=path_info.season,
            episode=path_info.episode,
            confidence=min(path_info.confidence, 0.4),
            source="path_only",
        )

    title = data.get("title") if isinstance(data, dict) else None
    season = data.get("season") if isinstance(data, dict) else None
    episode = data.get("episode") if isinstance(data, dict) else None
    confidence = data.get("confidence") if isinstance(data, dict) else 0.0
    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(confidence, 1.0))

    source = "llm"
    if path_info.source != "none":
        source = "path+llm"
    return WorkInfo(title=title, season=season, episode=episode, confidence=confidence, source=source)


def detect_work_info(path, sample_lines, llm_client=None):
    path_info = guess_work_info_from_path(path)
    if llm_client is None:
        return path_info
    return refine_work_info_via_llm(path_info, sample_lines, llm_client, path=path)


def log(level, message, **kwargs):
    parts = [f"[{level}]", message]
    if kwargs:
        parts.append(json.dumps(kwargs, ensure_ascii=False))
    print(" ".join(parts), flush=True)


def ensure_dirs():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)
    os.makedirs(WATCH_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)
    if MOVE_DONE:
        os.makedirs(DONE_DIR, exist_ok=True)


def is_video_file(path):
    return os.path.splitext(path)[1].lower() in VIDEO_EXTS


def base_name(path):
    return os.path.splitext(os.path.basename(path))[0]


def output_paths(name):
    suffix_name = f"{name}{OUTPUT_LANG_SUFFIX}"
    srt_path = os.path.join(OUT_DIR, f"{suffix_name}.srt")
    done_path = os.path.join(OUT_DIR, f"{suffix_name}.done")
    lock_path = os.path.join(OUT_DIR, f"{suffix_name}.lock")
    raw_path = os.path.join(OUT_DIR, f"{suffix_name}.raw.json")
    return srt_path, done_path, lock_path, raw_path


def is_stable_file(path):
    try:
        size1 = os.path.getsize(path)
        if size1 < MIN_BYTES:
            return False
        time.sleep(5)
        size2 = os.path.getsize(path)
        return size1 == size2
    except FileNotFoundError:
        return False


def is_lock_stale(lock_path):
    try:
        age = time.time() - os.path.getmtime(lock_path)
        return age > LOCK_TTL
    except FileNotFoundError:
        return False


def create_lock(lock_path):
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        with os.fdopen(fd, "w") as f:
            f.write(str(int(time.time())))
        return True
    except FileExistsError:
        return False


def remove_lock(lock_path):
    try:
        os.remove(lock_path)
    except FileNotFoundError:
        pass


def ffmpeg_extract_wav(video_path, wav_path):
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-ac",
        "1",
        "-ar",
        "16000",
        wav_path,
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def retry(operation, attempts=3, delay=2):
    last_exc = None
    for i in range(attempts):
        try:
            return operation()
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if i < attempts - 1:
                time.sleep(delay)
    raise last_exc


def oss_client():
    auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
    return oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET)


def upload_to_oss(bucket, local_path, object_key):
    def _upload():
        bucket.put_object_from_file(object_key, local_path)
        return True

    retry(_upload)


def oss_url(bucket, object_key):
    if OSS_URL_MODE == "public":
        endpoint = OSS_ENDPOINT.replace("https://", "").replace("http://", "")
        return f"https://{OSS_BUCKET}.{endpoint}/{object_key}"

    def _presign():
        return bucket.sign_url("GET", object_key, OSS_PRESIGN_EXPIRE)

    return retry(_presign)


def delete_oss_object(bucket, object_key):
    def _delete():
        bucket.delete_object(object_key)
        return True

    retry(_delete)


def dashscope_transcribe(url):
    dashscope.api_key = DASHSCOPE_API_KEY

    def _call():
        kwargs = {"model": ASR_MODEL, "file_urls": [url]}
        if ASR_MODEL == "paraformer-v2" and LANGUAGE_HINTS:
            kwargs["language_hints"] = LANGUAGE_HINTS
        return Transcription.async_call(**kwargs)

    async_resp = retry(_call)
    async_output = getattr(async_resp, "output", None)
    task_id = None
    if isinstance(async_output, dict):
        task_id = async_output.get("task_id")
    if not task_id and isinstance(async_resp, dict):
        task_id = async_resp.get("output", {}).get("task_id")
    if not task_id:
        raise RuntimeError("无法获取 DashScope 任务 ID")

    def _wait():
        return Transcription.wait(task=task_id)

    return retry(_wait)


def to_dict(obj):
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        data = obj.to_dict()
        if hasattr(obj, "output") and "output" not in data:
            data["output"] = getattr(obj, "output")
        return data
    if hasattr(obj, "__dict__"):
        data = obj.__dict__
        if hasattr(obj, "output") and "output" not in data:
            data["output"] = getattr(obj, "output")
        return data
    return {"value": str(obj)}


def to_seconds(value, scale):
    if value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num * scale


def build_srt_from_sentences(sentences, scale):
    subs = []
    for item in sentences:
        text = item.get("text") or item.get("sentence") or item.get("transcription")
        start = to_seconds(
            item.get("begin_time") or item.get("start_time") or item.get("start"),
            scale,
        )
        end = to_seconds(item.get("end_time") or item.get("end"), scale)
        if not text or start is None or end is None:
            continue
        if end <= start:
            end = start + 0.5
        subs.append(
            srt.Subtitle(
                index=len(subs) + 1,
                start=timedelta(seconds=start),
                end=timedelta(seconds=end),
                content=text.strip(),
            )
        )
    return subs


def is_punct(token):
    return token in {",", ".", "?", "!", ":", ";", "。", "？", "！"}


def build_srt_from_words(words, scale):
    subs = []
    buffer_tokens = []
    seg_start = None
    seg_end = None

    for item in words:
        token = item.get("text") or item.get("word") or ""
        start = to_seconds(
            item.get("begin_time") or item.get("start_time") or item.get("start"),
            scale,
        )
        end = to_seconds(item.get("end_time") or item.get("end"), scale)
        if not token or start is None or end is None:
            continue
        if seg_start is None:
            seg_start = start
        seg_end = end
        buffer_tokens.append(token)

        should_break = is_punct(token) or len(buffer_tokens) >= 12
        if should_break:
            text = " ".join(buffer_tokens)
            text = re.sub(r"\s+([,.;:!?])", r"\1", text)
            if seg_end <= seg_start:
                seg_end = seg_start + 0.5
            subs.append(
                srt.Subtitle(
                    index=len(subs) + 1,
                    start=timedelta(seconds=seg_start),
                    end=timedelta(seconds=seg_end),
                    content=text.strip(),
                )
            )
            buffer_tokens = []
            seg_start = None
            seg_end = None

    if buffer_tokens and seg_start is not None and seg_end is not None:
        text = " ".join(buffer_tokens)
        text = re.sub(r"\s+([,.;:!?])", r"\1", text)
        if seg_end <= seg_start:
            seg_end = seg_start + 0.5
        subs.append(
            srt.Subtitle(
                index=len(subs) + 1,
                start=timedelta(seconds=seg_start),
                end=timedelta(seconds=seg_end),
                content=text.strip(),
            )
        )
    return subs


def max_time(items):
    max_ts = 0.0
    for item in items:
        for key in ("begin_time", "start_time", "start", "end_time", "end"):
            value = item.get(key)
            try:
                num = float(value)
            except (TypeError, ValueError):
                continue
            if num > max_ts:
                max_ts = num
    return max_ts


def build_srt(response):
    resp_dict = to_dict(response)
    output = resp_dict.get("output", resp_dict)
    result = None

    if isinstance(output, dict):
        results = output.get("results")
        if isinstance(results, list) and results:
            result = results[0]
        else:
            result = output
    elif isinstance(output, list) and output:
        result = output[0]

    if not isinstance(result, dict):
        raise RuntimeError("DashScope 返回结构无法解析")

    transcripts = result.get("transcripts")
    if isinstance(transcripts, list) and transcripts:
        result = transcripts[0]

    sentences = result.get("sentences") or result.get("sentence_list") or []
    words = result.get("words") or result.get("word_list") or []
    transcription_url = result.get("transcription_url")

    if not sentences and not words and transcription_url:
        def _fetch():
            resp = requests.get(transcription_url, timeout=30)
            resp.raise_for_status()
            return resp.json()

        fetched = retry(_fetch)
        if isinstance(fetched, dict):
            result = fetched
            transcripts = result.get("transcripts")
            if isinstance(transcripts, list) and transcripts:
                result = transcripts[0]
            sentences = result.get("sentences") or result.get("sentence_list") or []
            words = result.get("words") or result.get("word_list") or []

    subs = []
    if isinstance(sentences, list) and sentences:
        scale = 0.001 if max_time(sentences) > 1000 else 1.0
        subs = build_srt_from_sentences(sentences, scale)
    if not subs and isinstance(words, list) and words:
        scale = 0.001 if max_time(words) > 1000 else 1.0
        subs = build_srt_from_words(words, scale)

    if not subs:
        raise RuntimeError("未找到带时间戳的识别结果")

    return subs, srt.compose(subs)


class TranslateCache:
    def __init__(self, db_path):
        self.db_path = db_path
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        with self.conn:
            self.conn.execute(
                "CREATE TABLE IF NOT EXISTS translations (key TEXT PRIMARY KEY, text TEXT)"
            )

    def get(self, key):
        with self.lock:
            cur = self.conn.execute("SELECT text FROM translations WHERE key = ?", (key,))
            row = cur.fetchone()
        return row[0] if row else None

    def set(self, key, text):
        with self.lock:
            self.conn.execute(
                "INSERT OR REPLACE INTO translations (key, text) VALUES (?, ?)",
                (key, text),
            )
            self.conn.commit()


def cache_key(src_lang, dst_lang, text):
    data = f"{src_lang}|{dst_lang}|{text}".encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def normalize_lines(text):
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        stripped = re.sub(r"^\\s*\\[\\d+\\]\\s*", "", stripped)
        stripped = re.sub(r"^\\s*\\d+[\\.\\)\\:]\\s*", "", stripped)
        lines.append(stripped)
    return lines


def wrap_lines(text, dst_lang):
    if MAX_CHARS_PER_LINE <= 0:
        return text
    if "\n" in text:
        return text
    if dst_lang.startswith("zh"):
        chars = list(text)
        chunks = [
            "".join(chars[i : i + MAX_CHARS_PER_LINE])
            for i in range(0, len(chars), MAX_CHARS_PER_LINE)
        ]
        return "\n".join(chunks)
    return text


def translate_via_llm(
    lines,
    cache,
    failed_log,
    src_lang,
    dst_lang,
    work_info=None,
    glossary=None,
    use_polish=False,
    llm_client=None,
):
    if llm_client is None:
        if not LLM_BASE_URL or not LLM_API_KEY:
            raise RuntimeError("缺少 LLM_BASE_URL 或 LLM_API_KEY")
        llm_client = llm_client_from_env()
    if llm_client is None:
        raise RuntimeError("缺少 LLM 客户端")

    to_translate = []
    results = [None] * len(lines)
    keys = []

    for i, text in enumerate(lines):
        key = cache_key(src_lang, dst_lang, text)
        cached = cache.get(key)
        if cached is not None:
            results[i] = cached
        else:
            keys.append((i, key))
            to_translate.append(text)

    if not to_translate:
        return results

    batches = []
    for idx in range(0, len(to_translate), BATCH_LINES):
        batch = to_translate[idx : idx + BATCH_LINES]
        batch_keys = keys[idx : idx + BATCH_LINES]
        batches.append((batch, batch_keys))

    def work_hint():
        if work_info is None or work_info.source == "none":
            return "作品信息未知。"
        title = work_info.title or "未知"
        season = work_info.season or "未知"
        episode = work_info.episode or "未知"
        if work_info.confidence >= 0.7:
            level = "很可能是"
        elif work_info.confidence >= 0.4:
            level = "可能是"
        else:
            level = "仅供参考，可能是"
        return f"{level}《{title}》，季/篇章：{season}，集数：{episode}。如有歧义以上下文为准。"

    def call_llm(batch_lines):
        glossary_hint = format_glossary(glossary)
        system_prompt = (
            f"你是专业影视字幕译者。翻译为{dst_lang}，保持与输入行数一致。"
            "一行输入对应一行输出，不要增删行。"
            "必须保留每行开头的编号 [n]，编号不可更改。"
            "不要添加解释、不要多余标点。"
            "遇到人名或专有名词尽量保留原文或音译。译文要短、口语化、适合字幕阅读。"
            f"\n\n{glossary_hint}"
        )
        context_hint = work_hint()
        indexed_lines = [f"[{i}] {line}" for i, line in enumerate(batch_lines, start=1)]
        user_prompt = (
            f"背景提示：{context_hint}\\n\\n"
            "下面是若干条字幕台词，每条前面都有编号 [n]。"
            "请根据上下文逐条翻译，保持行号不变。输出时每行以相同的编号开头，后面是译文。\\n"
            + "\\n".join(indexed_lines)
        )
        prompt = f"[system]\n{system_prompt}\n\n[user]\n{user_prompt}"
        for attempt in range(TRANSLATE_RETRY):
            try:
                return llm_client(prompt)
            except Exception:  # noqa: BLE001
                if attempt >= TRANSLATE_RETRY - 1:
                    raise
                time.sleep(2 * (2**attempt))

    def translate_batch(batch_lines, batch_keys):
        try:
            raw_output = call_llm(batch_lines)
            out_lines = normalize_lines(raw_output)
            if len(out_lines) != len(batch_lines):
                raise ValueError("line_mismatch")
            return out_lines, None
        except Exception as exc:  # noqa: BLE001
            return None, exc

    def translate_fallback_line(line):
        return normalize_lines(call_llm([line]))[0]

    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_TRANSLATIONS) as executor:
        future_map = {
            executor.submit(translate_batch, batch, batch_keys): (batch, batch_keys)
            for batch, batch_keys in batches
        }
        for future in as_completed(future_map):
            batch, batch_keys = future_map[future]
            out_lines, err = future.result()
            if err is None:
                for (idx, key), line in zip(batch_keys, out_lines):
                    cache.set(key, line)
                    results[idx] = line
                continue

            with open(failed_log, "a", encoding="utf-8") as f:
                f.write("BATCH_FAILED\\n")
                f.write("\\n".join(batch))
                f.write(f"\nERROR: {err}\n\n")

            for (idx, key), line in zip(batch_keys, batch):
                try:
                    translated = translate_fallback_line(line)
                    cache.set(key, translated)
                    results[idx] = translated
                except Exception as exc:  # noqa: BLE001
                    with open(failed_log, "a", encoding="utf-8") as f:
                        f.write("LINE_FAILED\\n")
                        f.write(line)
                        f.write(f"\nERROR: {exc}\n\n")
                    results[idx] = line

    if use_polish:
        results = polish_subtitles(
            lines,
            results,
            work_info=work_info,
            glossary=glossary,
            llm_client=llm_client,
            batch_size=POLISH_BATCH_SIZE,
        )
    return results


def polish_subtitles(
    original_lines,
    translated_lines,
    work_info=None,
    glossary=None,
    llm_client=None,
    batch_size=80,
):
    if llm_client is None:
        return translated_lines
    if not translated_lines:
        return translated_lines

    def polish_block(block_original, block_translated):
        glossary_hint = format_glossary(glossary)
        system_prompt = (
            "你是负责润色已有翻译字幕的编辑。"
            "不要重新翻译，只微调译文用词、统一术语、使上下文更自然。"
            "不得增删行，每行输出对应一行输入。"
            "每行必须保留开头编号 [n]，编号不可更改。"
            f"\n\n{glossary_hint}"
        )
        context_hint = "作品信息未知。"
        if work_info and work_info.source != "none":
            title = work_info.title or "未知"
            context_hint = f"作品提示：可能是《{title}》，如有歧义以上下文为准。"
        pairs = []
        for idx, (src, trans) in enumerate(zip(block_original, block_translated), start=1):
            pairs.append(f"[{idx}]\n原文：{src}\n译文：{trans}\n")
        user_prompt = (
            f"{context_hint}\n\n"
            "请按编号顺序润色译文，保持行数一致，只输出润色后的译文，每行以编号开头：\n"
            + "\n".join(pairs)
        )
        prompt = f"[system]\n{system_prompt}\n\n[user]\n{user_prompt}"
        raw = llm_client(prompt)
        out_lines = normalize_lines(raw)
        if len(out_lines) != len(block_translated):
            raise ValueError("line_mismatch")
        return out_lines

    polished = []
    for start in range(0, len(translated_lines), batch_size):
        end = start + batch_size
        block_original = original_lines[start:end]
        block_translated = translated_lines[start:end]
        try:
            polished_block = polish_block(block_original, block_translated)
        except Exception:  # noqa: BLE001
            polished_block = block_translated
        polished.extend(polished_block)
    return polished


def build_translated_subs(
    subs,
    cache,
    failed_log,
    src_lang,
    dst_lang,
    work_info=None,
    glossary=None,
    use_polish=False,
    llm_client=None,
):
    raw_lines = []
    for sub in subs:
        raw_lines.append(sub.content.replace("\n", "<br>"))

    translated = translate_via_llm(
        raw_lines,
        cache,
        failed_log,
        src_lang,
        dst_lang,
        work_info=work_info,
        glossary=glossary,
        use_polish=use_polish,
        llm_client=llm_client,
    )
    new_subs = []
    for sub, text in zip(subs, translated):
        content = text.replace("<br>", "\n").strip()
        content = wrap_lines(content, dst_lang)
        new_subs.append(
            srt.Subtitle(
                index=sub.index,
                start=sub.start,
                end=sub.end,
                content=content,
            )
        )
    return new_subs


def llm_client_from_env():
    if not LLM_BASE_URL or not LLM_API_KEY:
        return None

    def build_messages(prompt):
        if prompt.startswith("[system]") and "\n\n[user]\n" in prompt:
            system_part, user_part = prompt.split("\n\n[user]\n", 1)
            system_text = system_part.replace("[system]\n", "", 1)
            return [
                {"role": "system", "content": system_text.strip()},
                {"role": "user", "content": user_part.strip()},
            ]
        return [{"role": "user", "content": prompt}]

    def _call(prompt):
        payload = {
            "model": LLM_MODEL,
            "temperature": LLM_TEMPERATURE,
            "max_tokens": LLM_MAX_TOKENS,
            "messages": build_messages(prompt),
        }
        headers = {"Authorization": f"Bearer {LLM_API_KEY}"}
        url = LLM_BASE_URL.rstrip("/") + "/chat/completions"
        resp = requests.post(url, headers=headers, json=payload, timeout=60)
        if 400 <= resp.status_code < 500:
            raise RuntimeError(f"LLM 4xx: {resp.status_code} {resp.text}")
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]

    return _call


def build_bilingual_subs(raw_subs, trans_subs):
    new_subs = []
    for raw, trans in zip(raw_subs, trans_subs):
        if BILINGUAL_ORDER == "trans_first":
            content = f"{trans.content}\\n{raw.content}"
        else:
            content = f"{raw.content}\\n{trans.content}"
        new_subs.append(
            srt.Subtitle(
                index=raw.index,
                start=raw.start,
                end=raw.end,
                content=content,
            )
        )
    return new_subs


def translate_failed_path(name, dst_lang, multiple):
    if multiple:
        return os.path.join(OUT_DIR, f"{name}.translate_failed.{dst_lang}.log")
    return os.path.join(OUT_DIR, f"{name}.translate_failed.log")


def should_skip(video_path):
    name = base_name(video_path)
    srt_path, done_path, lock_path, _ = output_paths(name)

    if os.path.exists(srt_path):
        return True, "srt_exists"
    if os.path.exists(done_path):
        return True, "done_exists"
    if os.path.exists(lock_path):
        if is_lock_stale(lock_path):
            log("INFO", "清理过期锁", path=video_path)
            remove_lock(lock_path)
            return False, "lock_stale_removed"
        return True, "lock_exists"
    return False, ""


def process_video(video_path):
    name = base_name(video_path)
    srt_path, done_path, lock_path, raw_path = output_paths(name)
    bi_path = os.path.join(OUT_DIR, f"{name}.bi.srt")

    skip, reason = should_skip(video_path)
    if skip:
        log("SKIP", "已处理或正在处理", path=video_path, reason=reason)
        return

    if not is_stable_file(video_path):
        log("SKIP", "文件未下载完成", path=video_path)
        return

    if not create_lock(lock_path):
        log("SKIP", "锁已存在", path=video_path)
        return

    tmp_wav = os.path.join(TMP_DIR, f"{name}-{uuid.uuid4().hex}.wav")
    object_key = None
    bucket = None

    try:
        log("INFO", "开始处理", path=video_path)
        ffmpeg_extract_wav(video_path, tmp_wav)

        object_key = f"{OSS_PREFIX}{os.path.basename(tmp_wav)}"
        bucket = oss_client()
        upload_to_oss(bucket, tmp_wav, object_key)
        url = oss_url(bucket, object_key)

        response = dashscope_transcribe(url)
        if SAVE_RAW_JSON:
            with open(raw_path, "w", encoding="utf-8") as f:
                json.dump(to_dict(response), f, ensure_ascii=False, indent=2)

        subs, srt_text = build_srt(response)
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write(srt_text)
        with open(done_path, "w", encoding="utf-8") as f:
            f.write("done")

        if TRANSLATE:
            try:
                cache = TranslateCache(CACHE_DB)
                llm_client = llm_client_from_env()
                sample_lines = []
                for sub in subs:
                    for line in sub.content.splitlines():
                        line = line.strip()
                        if line:
                            sample_lines.append(line)
                        if len(sample_lines) >= 30:
                            break
                    if len(sample_lines) >= 30:
                        break
                work_info = detect_work_info(video_path, sample_lines, llm_client=llm_client)
                raw_glossary = load_glossary_from_yaml(GLOSSARY_PATH)
                glossary = build_effective_glossary(
                    raw_glossary,
                    work_info,
                    confidence_threshold=GLOSSARY_CONFIDENCE_THRESHOLD,
                )
                dst_langs = parse_langs()
                if not dst_langs:
                    raise RuntimeError("DST_LANG 或 DST_LANGS 为空")
                bi_lang = BILINGUAL_LANG or dst_langs[0]
                multiple = len(dst_langs) > 1

                for dst_lang in dst_langs:
                    trans_path = os.path.join(OUT_DIR, f"{name}.{dst_lang}.srt")
                    failed_log = translate_failed_path(name, dst_lang, multiple)
                    try:
                        trans_subs = build_translated_subs(
                            subs,
                            cache,
                            failed_log,
                            SRC_LANG,
                            dst_lang,
                            work_info=work_info,
                            glossary=glossary,
                            use_polish=USE_POLISH,
                            llm_client=llm_client,
                        )
                        trans_text = srt.compose(trans_subs)
                        with open(trans_path, "w", encoding="utf-8") as f:
                            f.write(trans_text)
                        if BILINGUAL and dst_lang == bi_lang:
                            bi_subs = build_bilingual_subs(subs, trans_subs)
                            bi_text = srt.compose(bi_subs)
                            with open(bi_path, "w", encoding="utf-8") as f:
                                f.write(bi_text)
                    except Exception as exc:  # noqa: BLE001
                        with open(failed_log, "a", encoding="utf-8") as f:
                            f.write(f"TRANSLATE_FAILED: {exc}\n")
                        log("ERROR", "翻译失败", path=video_path, lang=dst_lang, error=str(exc))
            except Exception as exc:  # noqa: BLE001
                failed_log = translate_failed_path(name, DST_LANG or "unknown", True)
                with open(failed_log, "a", encoding="utf-8") as f:
                    f.write(f"TRANSLATE_FAILED: {exc}\n")
                log("ERROR", "翻译初始化失败", path=video_path, error=str(exc))

        if MOVE_DONE:
            target = os.path.join(DONE_DIR, os.path.basename(video_path))
            shutil.move(video_path, target)

        log("DONE", "处理完成", path=video_path, srt=srt_path)
    except Exception as exc:  # noqa: BLE001
        log("ERROR", "处理失败", path=video_path, error=str(exc))
    finally:
        remove_lock(lock_path)
        try:
            if os.path.exists(tmp_wav):
                os.remove(tmp_wav)
        except OSError:
            pass
        if DELETE_OSS_OBJECT and bucket and object_key:
            try:
                delete_oss_object(bucket, object_key)
            except Exception as exc:  # noqa: BLE001
                log("ERROR", "删除 OSS 对象失败", path=video_path, error=str(exc))


def scan_once(q, pending, lock):
    try:
        entries = os.listdir(WATCH_DIR)
    except FileNotFoundError:
        return
    for name in entries:
        path = os.path.join(WATCH_DIR, name)
        if not os.path.isfile(path):
            continue
        if not is_video_file(path):
            continue
        enqueue(path, q, pending, lock)


def scan_loop(q, pending, lock):
    while True:
        scan_once(q, pending, lock)
        time.sleep(SCAN_INTERVAL)


def enqueue(path, q, pending, lock):
    with lock:
        if path in pending:
            return
        pending.add(path)
        q.put(path)


def worker_loop(q, pending, lock):
    while True:
        path = q.get()
        try:
            if os.path.isfile(path) and is_video_file(path):
                process_video(path)
        finally:
            with lock:
                pending.discard(path)
            q.task_done()


def inotify_loop(q, pending, lock):
    cmd = [
        "inotifywait",
        "-m",
        "-e",
        "close_write",
        "-e",
        "moved_to",
        "--format",
        "%w%f",
        WATCH_DIR,
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    for line in proc.stdout:
        path = line.strip()
        if not path:
            continue
        if os.path.isfile(path) and is_video_file(path):
            enqueue(path, q, pending, lock)


if __name__ == "__main__":
    ensure_dirs()

    if not DASHSCOPE_API_KEY:
        log("ERROR", "缺少 DASHSCOPE_API_KEY")
    if not (OSS_ENDPOINT and OSS_BUCKET and OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET):
        log("ERROR", "缺少 OSS 配置")

    q = queue.Queue()
    pending = set()
    lock = threading.Lock()

    threading.Thread(target=worker_loop, args=(q, pending, lock), daemon=True).start()
    threading.Thread(target=scan_loop, args=(q, pending, lock), daemon=True).start()

    log("INFO", "开始监听", watch=WATCH_DIR, out=OUT_DIR)
    inotify_loop(q, pending, lock)
