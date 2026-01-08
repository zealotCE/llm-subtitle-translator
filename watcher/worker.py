import hashlib
import json
import os
import queue
import threading
import re
import shutil
import sqlite3
import subprocess
import signal
import time
import uuid
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from dataclasses import dataclass
from typing import Callable, Dict, List, NamedTuple, Optional
import wave

import dashscope
import oss2
import requests
import srt
import yaml
from dashscope.audio.asr import Recognition, RecognitionCallback, Transcription, VocabularyService

VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov", ".avi"}
MIN_BYTES = 1 * 1024 * 1024
SUBTITLE_EXTS = {".srt", ".ass", ".ssa", ".vtt"}

WATCH_DIR = os.getenv("WATCH_DIR", "/watch")
WATCH_DIRS = os.getenv("WATCH_DIRS", "").strip()
WATCH_RECURSIVE = os.getenv("WATCH_RECURSIVE", "true").lower() == "true"
OUT_DIR = os.getenv("OUT_DIR", "/output")
TMP_DIR = os.getenv("TMP_DIR", "/tmp")
SCAN_INTERVAL = int(os.getenv("SCAN_INTERVAL", "300"))
LOCK_TTL = int(os.getenv("LOCK_TTL", "7200"))
OUTPUT_TO_SOURCE_DIR = os.getenv("OUTPUT_TO_SOURCE_DIR", "true").lower() == "true"
TRIGGER_SCAN_FILE = os.getenv("TRIGGER_SCAN_FILE", ".scan_now").strip()
WORKER_CONCURRENCY = int(os.getenv("WORKER_CONCURRENCY", "1"))
FFMPEG_CONCURRENCY = int(os.getenv("FFMPEG_CONCURRENCY", "1"))
MAX_ACTIVE_JOBS = int(os.getenv("MAX_ACTIVE_JOBS", str(WORKER_CONCURRENCY)))
QUEUE_PRIORITY_ENABLED = os.getenv("QUEUE_PRIORITY_ENABLED", "true").lower() == "true"
QUEUE_PRIORITY_FAILED = int(os.getenv("QUEUE_PRIORITY_FAILED", "0"))
QUEUE_PRIORITY_MISSING_ZH = int(os.getenv("QUEUE_PRIORITY_MISSING_ZH", "1"))
QUEUE_PRIORITY_DEFAULT = int(os.getenv("QUEUE_PRIORITY_DEFAULT", "5"))
ASR_MODE = os.getenv("ASR_MODE", "offline").strip().lower()
SEGMENT_MODE = os.getenv("SEGMENT_MODE", "post").strip().lower()
ASR_SAMPLE_RATE = int(os.getenv("ASR_SAMPLE_RATE", "16000"))
ASR_REALTIME_CHUNK_SECONDS = int(os.getenv("ASR_REALTIME_CHUNK_SECONDS", "900"))
ASR_REALTIME_CHUNK_OVERLAP_MS = int(os.getenv("ASR_REALTIME_CHUNK_OVERLAP_MS", "500"))
ASR_REALTIME_RETRY = int(os.getenv("ASR_REALTIME_RETRY", "2"))
ASR_REALTIME_CHUNK_MIN_SECONDS = int(os.getenv("ASR_REALTIME_CHUNK_MIN_SECONDS", "300"))
ASR_REALTIME_CHUNK_MAX_SECONDS = int(os.getenv("ASR_REALTIME_CHUNK_MAX_SECONDS", "900"))
ASR_REALTIME_CHUNK_TARGET = int(os.getenv("ASR_REALTIME_CHUNK_TARGET", "12"))
ASR_REALTIME_FAILURE_RATE_THRESHOLD = float(
    os.getenv("ASR_REALTIME_FAILURE_RATE_THRESHOLD", "0.3")
)
ASR_REALTIME_ADAPTIVE_RETRY = (
    os.getenv("ASR_REALTIME_ADAPTIVE_RETRY", "true").lower() == "true"
)
ASR_REALTIME_STREAMING_ENABLED = (
    os.getenv("ASR_REALTIME_STREAMING_ENABLED", "false").lower() == "true"
)
ASR_REALTIME_STREAM_FRAME_MS = int(os.getenv("ASR_REALTIME_STREAM_FRAME_MS", "100"))
ASR_REALTIME_FALLBACK_ENABLED = (
    os.getenv("ASR_REALTIME_FALLBACK_ENABLED", "true").lower() == "true"
)
ASR_REALTIME_FALLBACK_MAX_SENTENCE_SILENCE = int(
    os.getenv("ASR_REALTIME_FALLBACK_MAX_SENTENCE_SILENCE", "1200")
)
ASR_REALTIME_FALLBACK_MULTI_THRESHOLD = (
    os.getenv("ASR_REALTIME_FALLBACK_MULTI_THRESHOLD", "true").lower() == "true"
)
ASR_FAIL_COOLDOWN_SECONDS = int(os.getenv("ASR_FAIL_COOLDOWN_SECONDS", "3600") or "0")
ASR_MAX_FAILURES = int(os.getenv("ASR_MAX_FAILURES", "3") or "0")
ASR_FAIL_ALERT = os.getenv("ASR_FAIL_ALERT", "true").strip().lower() != "false"
ASR_SEMANTIC_PUNCTUATION_ENABLED = (
    os.getenv("ASR_SEMANTIC_PUNCTUATION_ENABLED", "false").lower() == "true"
)
ASR_MAX_SENTENCE_SILENCE = int(os.getenv("ASR_MAX_SENTENCE_SILENCE", "800"))
ASR_MULTI_THRESHOLD_MODE_ENABLED = (
    os.getenv("ASR_MULTI_THRESHOLD_MODE_ENABLED", "false").lower() == "true"
)
ASR_PUNCTUATION_PREDICTION_ENABLED = (
    os.getenv("ASR_PUNCTUATION_PREDICTION_ENABLED", "true").lower() == "true"
)
ASR_DISFLUENCY_REMOVAL_ENABLED = (
    os.getenv("ASR_DISFLUENCY_REMOVAL_ENABLED", "false").lower() == "true"
)
ASR_HEARTBEAT = os.getenv("ASR_HEARTBEAT", "false").lower() == "true"

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
DELETE_SOURCE_AFTER_DONE = os.getenv("DELETE_SOURCE_AFTER_DONE", "false").lower() == "true"
OUTPUT_LANG_SUFFIX = os.getenv("OUTPUT_LANG_SUFFIX", "").strip()
if OUTPUT_LANG_SUFFIX and not OUTPUT_LANG_SUFFIX.startswith("."):
    OUTPUT_LANG_SUFFIX = f".{OUTPUT_LANG_SUFFIX}"

TRANSLATE = os.getenv("TRANSLATE", "true").lower() == "true"
USE_EXISTING_SUBTITLE = os.getenv("USE_EXISTING_SUBTITLE", "true").lower() == "true"
SIMPLIFIED_LANG = os.getenv("SIMPLIFIED_LANG", "zh").strip() or "zh"
IGNORE_SIMPLIFIED_SUBTITLE = os.getenv("IGNORE_SIMPLIFIED_SUBTITLE", "false").lower() == "true"
SUBTITLE_MODE = os.getenv("SUBTITLE_MODE", "reuse_if_good").strip().lower()
SUBTITLE_PREFER_LANGS_SRC = [
    item.strip() for item in os.getenv("SUBTITLE_PREFER_LANGS_SRC", "jpn,ja").split(",") if item.strip()
]
SUBTITLE_PREFER_LANGS_DST = [
    item.strip() for item in os.getenv("SUBTITLE_PREFER_LANGS_DST", "chi,zh,zh-hans").split(",") if item.strip()
]
SUBTITLE_EXCLUDE_TITLES = [
    item.strip() for item in os.getenv("SUBTITLE_EXCLUDE_TITLES", "sign,song,karaoke").split(",") if item.strip()
]
SUBTITLE_INDEX = os.getenv("SUBTITLE_INDEX", "").strip()
SUBTITLE_LANG = os.getenv("SUBTITLE_LANG", "").strip()
SUBTITLE_REUSE_MIN_CONFIDENCE = float(os.getenv("SUBTITLE_REUSE_MIN_CONFIDENCE", "0.35"))
SUBTITLE_REUSE_SAMPLE_CHARS = int(os.getenv("SUBTITLE_REUSE_SAMPLE_CHARS", "2000"))

AUDIO_PREFER_LANGS = [
    item.strip() for item in os.getenv("AUDIO_PREFER_LANGS", "jpn,ja,eng,en").split(",") if item.strip()
]
AUDIO_EXCLUDE_TITLES = [
    item.strip() for item in os.getenv("AUDIO_EXCLUDE_TITLES", "commentary,コメンタリー").split(",") if item.strip()
]
AUDIO_INDEX = os.getenv("AUDIO_INDEX", "").strip()
AUDIO_LANG = os.getenv("AUDIO_LANG", "").strip()

METADATA_ENABLED = os.getenv("METADATA_ENABLED", "false").lower() == "true"
METADATA_LANGUAGE_PRIORITY = [
    item.strip() for item in os.getenv("METADATA_LANGUAGE_PRIORITY", "ja-JP,zh-CN,en-US").split(",") if item.strip()
]
METADATA_MIN_CONFIDENCE = float(os.getenv("METADATA_MIN_CONFIDENCE", "0.5"))
METADATA_CACHE_TTL = int(os.getenv("METADATA_CACHE_TTL", "86400"))
METADATA_DEBUG = os.getenv("METADATA_DEBUG", "false").lower() == "true"
METADATA_MIN_TITLE_SIMILARITY = float(os.getenv("METADATA_MIN_TITLE_SIMILARITY", "0.6"))
TITLE_ALIASES_PATH = os.getenv("TITLE_ALIASES_PATH", "").strip()
LLM_TITLE_ALIAS_ENABLED = os.getenv("LLM_TITLE_ALIAS_ENABLED", "true").lower() == "true"
WORK_GLOSSARY_DIR = os.getenv("WORK_GLOSSARY_DIR", "glossary").strip()
WORK_GLOSSARY_ENABLED = os.getenv("WORK_GLOSSARY_ENABLED", "true").lower() == "true"
ASR_HOTWORDS_ENABLED = os.getenv("ASR_HOTWORDS_ENABLED", "false").lower() == "true"
ASR_HOTWORDS_MAX = int(os.getenv("ASR_HOTWORDS_MAX", "50"))
ASR_HOTWORDS_LANGS = [
    item.strip() for item in os.getenv("ASR_HOTWORDS_LANGS", "ja,jpn,en,eng,zh,chi").split(",") if item.strip()
]
ASR_HOTWORDS_PARAM = os.getenv("ASR_HOTWORDS_PARAM", "hot_words").strip() or "hot_words"
ASR_HOTWORDS_USE_GLOSSARY = os.getenv("ASR_HOTWORDS_USE_GLOSSARY", "true").lower() == "true"
ASR_HOTWORDS_USE_METADATA = os.getenv("ASR_HOTWORDS_USE_METADATA", "true").lower() == "true"
ASR_HOTWORDS_USE_TITLE_ALIASES = os.getenv("ASR_HOTWORDS_USE_TITLE_ALIASES", "true").lower() == "true"
ASR_HOTWORDS_MODE = os.getenv("ASR_HOTWORDS_MODE", "vocabulary").strip().lower()
ASR_HOTWORDS_WEIGHT = int(os.getenv("ASR_HOTWORDS_WEIGHT", "4"))
ASR_HOTWORDS_PREFIX = os.getenv("ASR_HOTWORDS_PREFIX", "autosub").strip()
ASR_HOTWORDS_TARGET_MODEL = os.getenv("ASR_HOTWORDS_TARGET_MODEL", "").strip()
ASR_HOTWORDS_ALLOW_MIXED = os.getenv("ASR_HOTWORDS_ALLOW_MIXED", "false").lower() == "true"

TMDB_ENABLED = os.getenv("TMDB_ENABLED", "true").lower() == "true"
TMDB_API_KEY = os.getenv("TMDB_API_KEY", "").strip()
TMDB_BASE_URL = os.getenv("TMDB_BASE_URL", "https://api.themoviedb.org/3").strip()

BANGUMI_ENABLED = os.getenv("BANGUMI_ENABLED", "true").lower() == "true"
BANGUMI_ACCESS_TOKEN = os.getenv("BANGUMI_ACCESS_TOKEN", "").strip()
BANGUMI_USER_AGENT = os.getenv("BANGUMI_USER_AGENT", "auto-subtitle/1.0").strip()
BANGUMI_BASE_URL = os.getenv("BANGUMI_BASE_URL", "https://api.bgm.tv").strip()

WMDB_ENABLED = os.getenv("WMDB_ENABLED", "false").lower() == "true"
WMDB_BASE_URL = os.getenv("WMDB_BASE_URL", "https://api.wmdb.tv").strip()

PROVIDER_WEIGHT_TMDB = float(os.getenv("PROVIDER_WEIGHT_TMDB", "1.0"))
PROVIDER_WEIGHT_BANGUMI = float(os.getenv("PROVIDER_WEIGHT_BANGUMI", "0.8"))
PROVIDER_WEIGHT_WMDB = float(os.getenv("PROVIDER_WEIGHT_WMDB", "0.5"))
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
MIN_TRANSLATE_DURATION = float(os.getenv("MIN_TRANSLATE_DURATION", "60"))
ASR_MAX_DURATION_SECONDS = float(os.getenv("ASR_MAX_DURATION_SECONDS", "3.5"))
ASR_MAX_CHARS = int(os.getenv("ASR_MAX_CHARS", "25"))
ASR_MIN_DURATION_SECONDS = float(os.getenv("ASR_MIN_DURATION_SECONDS", "1.0"))
ASR_MIN_CHARS = int(os.getenv("ASR_MIN_CHARS", "6"))
ASR_MERGE_GAP_MS = int(os.getenv("ASR_MERGE_GAP_MS", "400"))
GROUPING_ENABLED = os.getenv("GROUPING_ENABLED", "true").lower() == "true"
CONTEXT_AWARE_ENABLED = os.getenv("CONTEXT_AWARE_ENABLED", "true").lower() == "true"
NFO_ENABLED = os.getenv("NFO_ENABLED", "false").lower() == "true"
NFO_SAME_NAME_ONLY = os.getenv("NFO_SAME_NAME_ONLY", "true").lower() == "true"
LOG_DIR = os.getenv("LOG_DIR", "").strip()
if not LOG_DIR:
    LOG_DIR = os.path.join(OUT_DIR, "logs")
LOG_FILE_NAME = os.getenv("LOG_FILE_NAME", "worker.log").strip()
LOG_MAX_BYTES = int(os.getenv("LOG_MAX_BYTES", str(10 * 1024 * 1024)))
LOG_MAX_BACKUPS = int(os.getenv("LOG_MAX_BACKUPS", "5"))
LOG_LOCK = threading.Lock()
RUN_LOG_CONTEXT = threading.local()

CACHE_DIR = os.path.join(OUT_DIR, "cache")
CACHE_DB = os.path.join(CACHE_DIR, "translate_cache.db")

EVAL_COLLECT = os.getenv("EVAL_COLLECT", "false").lower() == "true"
EVAL_OUTPUT_DIR = os.getenv("EVAL_OUTPUT_DIR", "eval").strip()
EVAL_SAMPLE_RATE = float(os.getenv("EVAL_SAMPLE_RATE", "1.0"))
MANUAL_METADATA_DIR = os.getenv("MANUAL_METADATA_DIR", "metadata").strip()
SRT_VALIDATE = os.getenv("SRT_VALIDATE", "true").lower() == "true"
SRT_AUTO_FIX = os.getenv("SRT_AUTO_FIX", "true").lower() == "true"
LLM_RPS = float(os.getenv("LLM_RPS", "0"))
DASHSCOPE_RPS = float(os.getenv("DASHSCOPE_RPS", "0"))
METADATA_RPS = float(os.getenv("METADATA_RPS", "0"))

_RATE_LIMIT_LOCK = threading.Lock()
_RATE_LIMIT_STATE = {}

SIMPLIFIED_TOKENS = (
    "zh-hans",
    "zh_cn",
    "zh-cn",
    "chs",
    "sc",
    "简体",
    "简中",
    "gb",
)
TRADITIONAL_TOKENS = (
    "zh-hant",
    "zh_tw",
    "zh-tw",
    "cht",
    "tc",
    "繁体",
    "繁中",
    "big5",
)
TRADITIONAL_CHARS = set(
    "體臺後裏麼為這學聲國電風嗎門車廣畫線愛買雲雲龍麼萬與產"
)
SIMPLIFIED_HINT_CHARS = set(
    "这哪吗么为里对发会后云国门车广画线爱买"
)


class WorkInfo(NamedTuple):
    title: Optional[str]
    season: Optional[str]
    episode: Optional[str]
    confidence: float
    source: str


@dataclass
class SubtitleLine:
    index: int
    start_ms: int
    end_ms: int
    text_src: str
    group_id: Optional[int] = None
    text_dst: Optional[str] = None


@dataclass
class SubtitleGroup:
    group_id: int
    line_indices: List[int]
    full_text_src: str


@dataclass
class GroupingConfig:
    min_gap_ms: int
    short_len_chars: Optional[int]
    short_len_words: Optional[int]
    sentence_end_chars: str


def _clamp_positive(value: int, fallback: int) -> int:
    if value <= 0:
        return fallback
    return value


WORKER_CONCURRENCY = _clamp_positive(WORKER_CONCURRENCY, 1)
FFMPEG_CONCURRENCY = _clamp_positive(FFMPEG_CONCURRENCY, 1)
MAX_ACTIVE_JOBS = _clamp_positive(MAX_ACTIVE_JOBS, WORKER_CONCURRENCY)
ASR_SAMPLE_RATE = _clamp_positive(ASR_SAMPLE_RATE, 16000)
ASR_REALTIME_CHUNK_SECONDS = _clamp_positive(ASR_REALTIME_CHUNK_SECONDS, 900)
ASR_REALTIME_CHUNK_OVERLAP_MS = max(0, ASR_REALTIME_CHUNK_OVERLAP_MS)
ASR_REALTIME_RETRY = _clamp_positive(ASR_REALTIME_RETRY, 2)
ASR_REALTIME_CHUNK_MIN_SECONDS = _clamp_positive(ASR_REALTIME_CHUNK_MIN_SECONDS, 300)
ASR_REALTIME_CHUNK_MAX_SECONDS = _clamp_positive(ASR_REALTIME_CHUNK_MAX_SECONDS, 900)
ASR_REALTIME_CHUNK_TARGET = _clamp_positive(ASR_REALTIME_CHUNK_TARGET, 12)
ASR_REALTIME_FAILURE_RATE_THRESHOLD = max(0.0, ASR_REALTIME_FAILURE_RATE_THRESHOLD)
ASR_REALTIME_STREAM_FRAME_MS = _clamp_positive(ASR_REALTIME_STREAM_FRAME_MS, 100)
ASR_REALTIME_FALLBACK_MAX_SENTENCE_SILENCE = _clamp_positive(
    ASR_REALTIME_FALLBACK_MAX_SENTENCE_SILENCE, 1200
)
if ASR_MODE not in {"offline", "realtime", "auto"}:
    ASR_MODE = "offline"
if SEGMENT_MODE not in {"post", "auto"}:
    SEGMENT_MODE = "post"
FFMPEG_SEMAPHORE = threading.Semaphore(FFMPEG_CONCURRENCY)
JOB_SEMAPHORE = threading.Semaphore(MAX_ACTIVE_JOBS)


@contextmanager
def _semaphore_guard(semaphore: threading.Semaphore):
    semaphore.acquire()
    try:
        yield
    finally:
        semaphore.release()


@dataclass
class AudioTrackInfo:
    index: int
    language: Optional[str]
    title: Optional[str]
    codec: Optional[str]
    channels: Optional[int]
    is_default: bool
    is_forced: bool


@dataclass
class SubtitleTrackInfo:
    index: int
    language: Optional[str]
    title: Optional[str]
    codec: Optional[str]
    is_default: bool
    is_forced: bool
    is_image_based: bool
    kind: str = "embedded"
    path: Optional[str] = None


@dataclass
class MediaInfo:
    audio_tracks: List[AudioTrackInfo]
    subtitle_tracks: List[SubtitleTrackInfo]


@dataclass
class AudioSelectionConfig:
    prefer_langs: List[str]
    exclude_title_keywords: List[str]
    user_specified_index: Optional[int]
    user_specified_lang: Optional[str]


@dataclass
class SubtitleSelectionConfig:
    mode: str
    prefer_langs_src: List[str]
    prefer_langs_dst: List[str]
    exclude_title_keywords: List[str]
    user_specified_index: Optional[int]
    user_specified_lang: Optional[str]


@dataclass
class WorkQuery:
    raw_file_name: str
    directory_names: List[str]
    container_title: Optional[str]
    guessed_title: Optional[str]
    title_aliases: List[str]
    guessed_season: Optional[int]
    guessed_episode: Optional[int]
    guessed_year: Optional[int]
    guessed_type: Optional[str]
    subtitle_snippets: Dict[str, List[str]]
    language_priority: List[str]
    nfo_path: Optional[str]
    nfo_title: Optional[str]
    nfo_original_title: Optional[str]
    nfo_episode_title: Optional[str]
    external_ids: Dict[str, str]


@dataclass
class WorkMetadata:
    title_original: Optional[str]
    title_localized: Dict[str, str]
    type: Optional[str]
    year: Optional[int]
    season: Optional[int]
    episode: Optional[int]
    episode_title: Dict[str, str]
    characters: List[Dict[str, Dict[str, str]]]
    external_ids: Dict[str, object]
    confidence: float
    sources: List[str]
    raw: Dict[str, object]


@dataclass
class MetadataConfig:
    enabled: bool
    language_priority: List[str]
    tmdb_enabled: bool
    tmdb_api_key: str
    tmdb_base_url: str
    bangumi_enabled: bool
    bangumi_access_token: str
    bangumi_user_agent: str
    bangumi_base_url: str
    wmdb_enabled: bool
    wmdb_base_url: str
    min_confidence: float
    cache_ttl_seconds: int
    provider_weights: Dict[str, float]
    debug: bool


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


def _strip_quotes(value):
    if not value:
        return value
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1].strip()
    return value


def parse_watch_dirs():
    if not WATCH_DIRS:
        return []
    items = []
    for raw in WATCH_DIRS.split(","):
        raw = raw.strip()
        if not raw:
            continue
        raw = _strip_quotes(raw)
        if raw:
            items.append(raw)
    return items


WATCH_DIR_LIST = parse_watch_dirs()
GLOBAL_QUEUE = None
GLOBAL_PENDING = None
GLOBAL_LOCK = None


def _clean_title(text):
    if not text:
        return ""
    cleaned = text
    cleaned = re.sub(r"\[[^\]]*\]", " ", cleaned)
    cleaned = re.sub(r"\([^\)]*\)", " ", cleaned)
    cleaned = re.sub(r"\b(1080p|720p|2160p|4k|x264|x265|hevc|h264|h265)\b", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(web[- ]?dl|webrip|bdrip|hdrip|bluray|aac|flac|dts)\b", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(s\d{1,2}e\d{1,4})\b", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"[_\.]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def guess_work_info_from_path(path):
    filename = os.path.basename(path)
    name = os.path.splitext(filename)[0]
    season = None
    episode = None
    confidence = 0.1

    sxe = re.search(r"[sS](\d{1,2})\s*[eE](\d{1,4})", name)
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


def _find_nfo_file(video_path):
    if not NFO_ENABLED:
        return None
    base = os.path.splitext(video_path)[0]
    same = f"{base}.nfo"
    if os.path.exists(same):
        return same
    if NFO_SAME_NAME_ONLY:
        return None
    folder = os.path.dirname(video_path) or "."
    for name in ("tvshow.nfo", "movie.nfo"):
        path = os.path.join(folder, name)
        if os.path.exists(path):
            return path
    return None


def _nfo_text(root, tag):
    value = root.findtext(tag)
    if not value:
        value = root.findtext(f".//{tag}")
    if not value:
        return None
    value = str(value).strip()
    return value or None


def _parse_nfo_file(path):
    try:
        tree = ET.parse(path)
        root = tree.getroot()
    except Exception:  # noqa: BLE001
        return {}

    root_tag = (root.tag or "").lower()
    info = {"type": None, "external_ids": {}}

    title = _nfo_text(root, "title")
    original_title = _nfo_text(root, "originaltitle")
    show_title = _nfo_text(root, "showtitle")
    episode_title = _nfo_text(root, "title") if root_tag == "episodedetails" else None

    if root_tag == "tvshow":
        info["type"] = "tv"
    elif root_tag == "movie":
        info["type"] = "movie"
    elif root_tag == "episodedetails":
        info["type"] = "tv"

    if show_title and root_tag == "episodedetails":
        info["title"] = show_title
    else:
        info["title"] = title or show_title
    info["original_title"] = original_title
    info["episode_title"] = episode_title

    year = _nfo_text(root, "year") or _nfo_text(root, "premiered") or _nfo_text(root, "firstaired")
    if year:
        match = re.search(r"(19|20)\d{2}", year)
        if match:
            info["year"] = int(match.group(0))

    season = _nfo_text(root, "season")
    episode = _nfo_text(root, "episode")
    try:
        info["season"] = int(season) if season is not None else None
    except (TypeError, ValueError):
        info["season"] = None
    try:
        info["episode"] = int(episode) if episode is not None else None
    except (TypeError, ValueError):
        info["episode"] = None

    for elem in root.findall(".//uniqueid"):
        key = (elem.get("type") or "").lower()
        value = (elem.text or "").strip()
        if not value:
            continue
        if key in ("tmdb", "imdb", "tvdb", "douban"):
            info["external_ids"][key] = value
        elif key:
            info["external_ids"][key] = value

    imdb_id = _nfo_text(root, "imdbid")
    if imdb_id:
        info["external_ids"].setdefault("imdb", imdb_id)
    tmdb_id = _nfo_text(root, "tmdbid")
    if tmdb_id:
        info["external_ids"].setdefault("tmdb", tmdb_id)

    return info


def load_nfo_info(video_path):
    nfo_path = _find_nfo_file(video_path)
    if not nfo_path:
        return None, None
    info = _parse_nfo_file(nfo_path)
    if not info:
        return None, None
    info["path"] = nfo_path
    return info, nfo_path


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
    record = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "level": level,
        "message": message,
    }
    if kwargs:
        record.update(kwargs)
    parts = [f"[{level}]", message]
    if kwargs:
        parts.append(json.dumps(kwargs, ensure_ascii=False))
    print(" ".join(parts), flush=True)
    if LOG_DIR:
        try:
            os.makedirs(LOG_DIR, exist_ok=True)
            path = os.path.join(LOG_DIR, LOG_FILE_NAME)
            line = json.dumps(record, ensure_ascii=False)
            with LOG_LOCK:
                _rotate_log_if_needed(path)
                with open(path, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
        except Exception:  # noqa: BLE001
            pass
    run_log_path = getattr(RUN_LOG_CONTEXT, "path", "")
    if run_log_path:
        try:
            os.makedirs(os.path.dirname(run_log_path), exist_ok=True)
            line = json.dumps(record, ensure_ascii=False)
            with LOG_LOCK:
                with open(run_log_path, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
        except Exception:  # noqa: BLE001
            pass


def _rotate_log_if_needed(path):
    if LOG_MAX_BACKUPS <= 0 or LOG_MAX_BYTES <= 0:
        return
    try:
        if not os.path.exists(path):
            return
        if os.path.getsize(path) <= LOG_MAX_BYTES:
            return
        for idx in range(LOG_MAX_BACKUPS - 1, 0, -1):
            src = f"{path}.{idx}"
            dst = f"{path}.{idx + 1}"
            if os.path.exists(src):
                os.replace(src, dst)
        os.replace(path, f"{path}.1")
    except OSError:
        pass


def ensure_dirs():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)
    for path in WATCH_DIR_LIST:
        os.makedirs(path, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)
    if LOG_DIR:
        os.makedirs(LOG_DIR, exist_ok=True)
    if MOVE_DONE:
        os.makedirs(DONE_DIR, exist_ok=True)


def is_video_file(path):
    return os.path.splitext(path)[1].lower() in VIDEO_EXTS


def base_name(path):
    return os.path.splitext(os.path.basename(path))[0]


def output_dir_for(video_path):
    if OUTPUT_TO_SOURCE_DIR:
        return os.path.dirname(video_path) or OUT_DIR
    return OUT_DIR


def output_paths(name, out_dir):
    suffix_name = f"{name}{OUTPUT_LANG_SUFFIX}"
    srt_path = os.path.join(out_dir, f"{suffix_name}.srt")
    done_path = os.path.join(out_dir, f"{suffix_name}.done")
    lock_path = os.path.join(out_dir, f"{suffix_name}.lock")
    raw_path = os.path.join(out_dir, f"{suffix_name}.raw.json")
    return srt_path, done_path, lock_path, raw_path


def asr_failed_path(name, out_dir):
    return os.path.join(out_dir, f"{name}.asr_failed")


def load_asr_fail_state(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:  # noqa: BLE001
        return {}
    return {}


def save_asr_fail_state(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:  # noqa: BLE001
        pass


def is_realtime_model(model_name):
    if not model_name:
        return False
    name = model_name.strip().lower()
    realtime_models = {
        "fun-asr-realtime-2025-11-07",
        "paraformer-realtime-8k-v2",
        "paraformer-realtime-v2",
        "fun-asr-realtime",
        "paraformer-realtime",
    }
    return name in realtime_models or name.startswith("fun-asr-realtime")


def resolve_asr_mode(mode, model_name):
    if mode == "auto":
        return "realtime" if is_realtime_model(model_name) else "offline"
    return mode


def _run_log_token(video_path):
    return hashlib.sha1(video_path.encode("utf-8")).hexdigest()[:8]


def _run_log_paths(video_path, out_dir, run_id):
    token = _run_log_token(video_path)
    name = base_name(video_path)
    log_dir = LOG_DIR or out_dir
    log_path = os.path.join(log_dir, f"{name}.{token}.run.{run_id}.log")
    meta_path = os.path.join(out_dir, f"{name}.{token}.run.json")
    return log_path, meta_path


def _write_run_meta(path, data):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:  # noqa: BLE001
        pass


def should_collect_eval(video_path):
    if not EVAL_COLLECT:
        return False
    if EVAL_SAMPLE_RATE <= 0:
        return False
    if EVAL_SAMPLE_RATE >= 1:
        return True
    digest = hashlib.sha256(video_path.encode("utf-8")).hexdigest()
    value = int(digest[:8], 16) / 0xFFFFFFFF
    return value <= EVAL_SAMPLE_RATE


def eval_output_dir_for(out_dir):
    if not EVAL_OUTPUT_DIR:
        return ""
    if os.path.isabs(EVAL_OUTPUT_DIR):
        return EVAL_OUTPUT_DIR
    return os.path.join(out_dir, EVAL_OUTPUT_DIR)


def manual_metadata_dir_for(out_dir):
    if not MANUAL_METADATA_DIR:
        return ""
    if os.path.isabs(MANUAL_METADATA_DIR):
        return MANUAL_METADATA_DIR
    return os.path.join(out_dir, MANUAL_METADATA_DIR)


def load_manual_metadata(video_path, out_dir):
    name = base_name(video_path)
    meta_dir = manual_metadata_dir_for(out_dir)
    if not meta_dir:
        return None
    path = os.path.join(meta_dir, f"{name}.manual.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(data, dict):
        return None
    title_localized = data.get("title_localized") or {}
    episode_title = data.get("episode_title") or {}
    characters = data.get("characters") or []
    external_ids = data.get("external_ids") or {}
    return WorkMetadata(
        title_original=data.get("title_original"),
        title_localized=title_localized if isinstance(title_localized, dict) else {},
        type=data.get("type"),
        year=data.get("year"),
        season=data.get("season"),
        episode=data.get("episode"),
        episode_title=episode_title if isinstance(episode_title, dict) else {},
        characters=characters if isinstance(characters, list) else [],
        external_ids=external_ids if isinstance(external_ids, dict) else {},
        confidence=1.0,
        sources=["manual"],
        raw={"manual": data},
    )


def save_eval_sample(name, out_dir, reference_text, source_text, candidate_text, meta):
    eval_dir = eval_output_dir_for(out_dir)
    if not eval_dir:
        return
    os.makedirs(eval_dir, exist_ok=True)
    ref_path = os.path.join(eval_dir, f"{name}.eval.ref.srt")
    src_path = os.path.join(eval_dir, f"{name}.eval.src.srt")
    cand_path = os.path.join(eval_dir, f"{name}.eval.cand.srt")
    meta_path = os.path.join(eval_dir, f"{name}.eval.json")
    if reference_text:
        with open(ref_path, "w", encoding="utf-8") as f:
            f.write(reference_text)
    if source_text:
        with open(src_path, "w", encoding="utf-8") as f:
            f.write(source_text)
    if candidate_text:
        with open(cand_path, "w", encoding="utf-8") as f:
            f.write(candidate_text)
    if meta:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)


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


def ffmpeg_extract_wav(video_path, wav_path, audio_track_index=None, sample_rate=16000):
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-map",
        f"0:{audio_track_index}" if audio_track_index is not None else "0:a:0",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        wav_path,
    ]
    with _semaphore_guard(FFMPEG_SEMAPHORE):
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ffmpeg_extract_subtitle(video_path, stream_index, subtitle_path):
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-map",
        f"0:{stream_index}",
        "-c:s",
        "srt",
        subtitle_path,
    ]
    with _semaphore_guard(FFMPEG_SEMAPHORE):
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ffmpeg_convert_subtitle(input_path, output_path):
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-c:s",
        "srt",
        output_path,
    ]
    with _semaphore_guard(FFMPEG_SEMAPHORE):
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wav_duration_seconds(path):
    with wave.open(path, "rb") as wf:
        frames = wf.getnframes()
        rate = wf.getframerate()
        if rate <= 0:
            return 0.0
        return frames / float(rate)


def split_wav_by_duration(path, chunk_seconds, tmp_dir, overlap_ms=0):
    if chunk_seconds <= 0:
        return [(path, 0)]
    duration = wav_duration_seconds(path)
    if duration <= chunk_seconds:
        return [(path, 0)]

    chunks = []
    with wave.open(path, "rb") as wf:
        params = wf.getparams()
        rate = wf.getframerate()
        total_frames = wf.getnframes()
        frames_per_chunk = int(chunk_seconds * rate)
        overlap_frames = int((overlap_ms / 1000.0) * rate)
        if frames_per_chunk <= 0:
            return [(path, 0)]
        if overlap_frames >= frames_per_chunk:
            overlap_frames = max(0, frames_per_chunk // 2)
        start_frame = 0
        index = 0
        while start_frame < total_frames:
            wf.setpos(start_frame)
            frames = wf.readframes(frames_per_chunk)
            if not frames:
                break
            chunk_path = os.path.join(
                tmp_dir, f"chunk-{uuid.uuid4().hex}-{index}.wav"
            )
            with wave.open(chunk_path, "wb") as out:
                out.setparams(params)
                out.writeframes(frames)
            offset_ms = int((start_frame / float(rate)) * 1000)
            chunks.append((chunk_path, offset_ms))
            index += 1
            next_frame = start_frame + frames_per_chunk - overlap_frames
            if next_frame <= start_frame:
                next_frame = start_frame + frames_per_chunk
            start_frame = next_frame
    return chunks


def offset_subtitles(subs, offset_ms):
    if offset_ms <= 0:
        return subs
    offset = timedelta(milliseconds=offset_ms)
    return [
        srt.Subtitle(
            index=sub.index,
            start=sub.start + offset,
            end=sub.end + offset,
            content=sub.content,
        )
        for sub in subs
    ]


def merge_subtitle_chunks(chunks, overlap_ms=0):
    merged = []
    overlap_delta = timedelta(milliseconds=max(0, overlap_ms))
    for part in chunks:
        if not part:
            continue
        for sub in part:
            if not merged:
                merged.append(sub)
                continue
            last_end = merged[-1].end
            if sub.end <= last_end:
                continue
            if sub.start < last_end and sub.end <= last_end + overlap_delta:
                continue
            merged.append(sub)
    for i, sub in enumerate(merged, start=1):
        sub.index = i
    return merged


def choose_realtime_chunk_seconds(duration_seconds):
    if ASR_REALTIME_CHUNK_SECONDS > 0:
        return ASR_REALTIME_CHUNK_SECONDS
    if duration_seconds <= 0:
        return ASR_REALTIME_CHUNK_MAX_SECONDS
    if ASR_REALTIME_CHUNK_TARGET > 0:
        chunk = int((duration_seconds + ASR_REALTIME_CHUNK_TARGET - 1) / ASR_REALTIME_CHUNK_TARGET)
    else:
        chunk = ASR_REALTIME_CHUNK_MAX_SECONDS
    chunk = max(ASR_REALTIME_CHUNK_MIN_SECONDS, chunk)
    chunk = min(ASR_REALTIME_CHUNK_MAX_SECONDS, chunk)
    return max(1, chunk)


def job_override_path(video_path):
    name = base_name(video_path)
    return os.path.join(os.path.dirname(video_path), f"{name}.job.json")


def load_job_overrides(video_path):
    meta_path = job_override_path(video_path)
    if not os.path.exists(meta_path):
        return {}
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:  # noqa: BLE001
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def override_bool(value, default):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def run_realtime_chunks(
    video_path,
    tmp_wav,
    vocab_id,
    segment_mode="post",
    semantic_punctuation_enabled=None,
    max_sentence_silence=None,
    multi_threshold_mode_enabled=None,
):
    duration = wav_duration_seconds(tmp_wav)
    chunk_seconds = choose_realtime_chunk_seconds(duration)
    chunks = split_wav_by_duration(
        tmp_wav,
        chunk_seconds,
        TMP_DIR,
        overlap_ms=ASR_REALTIME_CHUNK_OVERLAP_MS,
    )
    log(
        "INFO",
        "实时 ASR 分片",
        path=video_path,
        chunks=len(chunks),
        chunk_seconds=chunk_seconds,
        overlap_ms=ASR_REALTIME_CHUNK_OVERLAP_MS,
    )
    responses = []
    chunk_subs = []
    failures = 0
    for chunk_path, offset_ms in chunks:
        try:
            def _call():
                if ASR_REALTIME_STREAMING_ENABLED:
                    return dashscope_realtime_streaming_transcribe(
                        chunk_path,
                        vocabulary_id=vocab_id,
                        semantic_punctuation_enabled=semantic_punctuation_enabled,
                        max_sentence_silence=max_sentence_silence,
                        multi_threshold_mode_enabled=multi_threshold_mode_enabled,
                    )
                return dashscope_realtime_transcribe(
                    chunk_path,
                    vocabulary_id=vocab_id,
                    semantic_punctuation_enabled=semantic_punctuation_enabled,
                    max_sentence_silence=max_sentence_silence,
                    multi_threshold_mode_enabled=multi_threshold_mode_enabled,
                )

            response = retry(_call, attempts=ASR_REALTIME_RETRY, delay=2)
            responses.append(to_dict(response))
            part_subs, _ = build_srt(response, segment_mode=segment_mode)
            part_subs = offset_subtitles(part_subs, offset_ms)
            chunk_subs.append(part_subs)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            log(
                "ERROR",
                "实时 ASR 分片失败",
                path=video_path,
                chunk=chunk_path,
                error=str(exc),
            )
        finally:
            if chunk_path != tmp_wav:
                try:
                    os.remove(chunk_path)
                except OSError:
                    pass
    merged_subs = merge_subtitle_chunks(
        chunk_subs, overlap_ms=ASR_REALTIME_CHUNK_OVERLAP_MS
    )
    return merged_subs, responses, failures, len(chunks), chunk_seconds


def read_text_file(path):
    try:
        with open(path, "rb") as f:
            data = f.read()
    except FileNotFoundError:
        return ""
    if data.startswith(b"\xef\xbb\xbf"):
        return data.decode("utf-8-sig", errors="ignore")
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return data.decode("utf-16", errors="ignore")
    for encoding in ("utf-8", "utf-16", "utf-16-le", "utf-16-be", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def sanitize_subtitle_text(text):
    lines = []
    for line in text.splitlines():
        stripped = line.lstrip("\ufeff")
        stripped = re.sub(r"<[^>]+>", "", stripped)
        stripped = re.sub(r"\{[^}]*\}", "", stripped)
        stripped = re.sub(r"^\s*\[\d+\]\s*", "", stripped)
        stripped = re.sub(r"^\s*\d+[.)\:]\s*", "", stripped)
        lines.append(stripped)
    return "\n".join(lines).strip()


def clean_line_prefix(text):
    if text is None:
        return ""
    stripped = str(text).lstrip("\ufeff").strip()
    stripped = re.sub(r"^\s*\[\d+\]\s*", "", stripped)
    stripped = re.sub(r"^\s*\d+[.)\:]\s*", "", stripped)
    return stripped


def get_grouping_config(src_lang):
    if src_lang and src_lang.lower().startswith("ja"):
        return GroupingConfig(
            min_gap_ms=600,
            short_len_chars=6,
            short_len_words=None,
            sentence_end_chars="。．！？!?…",
        )
    if src_lang and src_lang.lower().startswith("en"):
        return GroupingConfig(
            min_gap_ms=600,
            short_len_chars=None,
            short_len_words=3,
            sentence_end_chars=".?!…",
        )
    return GroupingConfig(
        min_gap_ms=600,
        short_len_chars=None,
        short_len_words=3,
        sentence_end_chars=".?!…",
    )


def _word_count(text):
    return len([item for item in re.split(r"\s+", text.strip()) if item])


def group_subtitles(lines, src_lang):
    cfg = get_grouping_config(src_lang)
    if not lines:
        return {}

    current_group_id = 0
    lines[0].group_id = current_group_id

    for i in range(1, len(lines)):
        prev = lines[i - 1]
        cur = lines[i]
        gap_ms = cur.start_ms - prev.end_ms

        prev_text = prev.text_src.strip()
        cur_text = cur.text_src.strip()
        prev_clean = prev_text.replace("<br>", " ").strip()
        cur_clean = cur_text.replace("<br>", " ").strip()

        is_short = False
        if cfg.short_len_chars is not None:
            is_short = len(cur_clean) <= cfg.short_len_chars
        if cfg.short_len_words is not None:
            is_short = is_short or (_word_count(cur_clean) <= cfg.short_len_words)

        prev_ends_with_sentence = bool(prev_clean) and prev_clean[-1] in cfg.sentence_end_chars
        time_continuous = gap_ms >= 0 and gap_ms <= cfg.min_gap_ms

        same_group = False
        if time_continuous:
            if is_short:
                same_group = True
            elif not prev_ends_with_sentence:
                same_group = True

        if same_group:
            cur.group_id = prev.group_id
        else:
            current_group_id += 1
            cur.group_id = current_group_id

    groups = {}
    for line in lines:
        gid = line.group_id
        if gid is None:
            continue
        group = groups.setdefault(
            gid, SubtitleGroup(group_id=gid, line_indices=[], full_text_src="")
        )
        group.line_indices.append(line.index)

    index_map = {line.index: line for line in lines}
    for group in groups.values():
        parts = []
        for idx in group.line_indices:
            parts.append(index_map[idx].text_src.strip())
        group.full_text_src = " ".join(part for part in parts if part)

    return groups


def _parse_int(value):
    if value is None:
        return None
    if isinstance(value, int):
        return value
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _normalize_lang(value):
    if not value:
        return ""
    return str(value).strip().lower().replace("_", "-")


def _is_image_based(codec):
    codec_name = (codec or "").lower()
    return codec_name in {
        "hdmv_pgs_subtitle",
        "pgs",
        "dvd_subtitle",
        "vobsub",
        "dvb_subtitle",
        "xsub",
    }


def probe_media(path):
    cmd = ["ffprobe", "-v", "error", "-show_streams", "-of", "json", path]
    try:
        output = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True)
        data = json.loads(output)
    except Exception:  # noqa: BLE001
        return MediaInfo(audio_tracks=[], subtitle_tracks=[])

    audio_tracks = []
    subtitle_tracks = []
    streams = data.get("streams", []) if isinstance(data, dict) else []
    for stream in streams:
        if not isinstance(stream, dict):
            continue
        codec_type = stream.get("codec_type")
        index = stream.get("index")
        tags = stream.get("tags", {}) if isinstance(stream.get("tags"), dict) else {}
        disposition = stream.get("disposition", {}) if isinstance(stream.get("disposition"), dict) else {}
        language = tags.get("language")
        title = tags.get("title")
        codec = stream.get("codec_name")
        is_default = bool(disposition.get("default"))
        is_forced = bool(disposition.get("forced"))

        if codec_type == "audio":
            channels = _parse_int(stream.get("channels"))
            audio_tracks.append(
                AudioTrackInfo(
                    index=index,
                    language=language,
                    title=title,
                    codec=codec,
                    channels=channels,
                    is_default=is_default,
                    is_forced=is_forced,
                )
            )
        elif codec_type == "subtitle":
            subtitle_tracks.append(
                SubtitleTrackInfo(
                    index=index,
                    language=language,
                    title=title,
                    codec=codec,
                    is_default=is_default,
                    is_forced=is_forced,
                    is_image_based=_is_image_based(codec),
                )
            )

    return MediaInfo(audio_tracks=audio_tracks, subtitle_tracks=subtitle_tracks)


def _track_with_index(tracks, index):
    for track in tracks:
        if track.index == index:
            return track
    return None


def _is_excluded_title(title, keywords):
    if not title:
        return False
    lower = title.lower()
    return any(keyword.lower() in lower for keyword in keywords)


def _lang_rank(lang, prefer_langs):
    if not lang:
        return len(prefer_langs) + 1
    norm = _normalize_lang(lang)
    for i, pref in enumerate(prefer_langs):
        if norm.startswith(_normalize_lang(pref)):
            return i
    return len(prefer_langs)


def select_audio_track(audio_tracks, cfg):
    if not audio_tracks:
        return None
    if cfg.user_specified_index is not None:
        selected = _track_with_index(audio_tracks, cfg.user_specified_index)
        if selected:
            return selected

    candidates = audio_tracks
    if cfg.user_specified_lang:
        lang = _normalize_lang(cfg.user_specified_lang)
        candidates = [
            track for track in audio_tracks if _normalize_lang(track.language).startswith(lang)
        ] or audio_tracks

    filtered = [
        track for track in candidates if not _is_excluded_title(track.title, cfg.exclude_title_keywords)
    ]
    if filtered:
        candidates = filtered

    candidates = sorted(
        candidates,
        key=lambda track: (
            _lang_rank(track.language, cfg.prefer_langs),
            0 if track.is_default else 1,
            -int(track.channels or 2),
            track.index,
        ),
    )
    return candidates[0]


def select_subtitle_track(subtitle_tracks, cfg, audio_lang):
    if cfg.mode == "ignore":
        return None
    if not subtitle_tracks:
        return None

    if cfg.user_specified_index is not None:
        selected = _track_with_index(subtitle_tracks, cfg.user_specified_index)
        if selected:
            return selected

    candidates = subtitle_tracks
    if cfg.user_specified_lang:
        lang = _normalize_lang(cfg.user_specified_lang)
        candidates = [
            track for track in candidates if _normalize_lang(track.language).startswith(lang)
        ] or candidates

    text_tracks = [track for track in candidates if not track.is_image_based]
    candidates = text_tracks or candidates

    def choose_by_lang(tracks, langs):
        filtered = [
            track for track in tracks if not _is_excluded_title(track.title, cfg.exclude_title_keywords)
        ]
        if not filtered:
            filtered = tracks
        if not filtered:
            return None
        return sorted(
            filtered,
            key=lambda track: (
                _lang_rank(track.language, langs),
                0 if track.is_default else 1,
                track.index,
            ),
        )[0]

    if cfg.mode == "reuse_if_good":
        best = choose_by_lang(candidates, cfg.prefer_langs_dst)
        if best:
            return best

    lang_candidates = cfg.prefer_langs_src or ([audio_lang] if audio_lang else [])
    return choose_by_lang(candidates, lang_candidates)


def guess_lang_from_label(text):
    lower = (text or "").lower()
    if any(token in lower for token in ("jpn", "ja", "japanese", "日本語")):
        return "jpn"
    if any(token in lower for token in ("eng", "en", "english")):
        return "eng"
    if any(token in lower for token in ("chi", "zh", "chs", "cht", "中文", "简体", "繁体")):
        return "chi"
    return None


def _safe_get_json(url, headers=None, params=None, timeout=10):
    rate_limit("metadata", METADATA_RPS)
    resp = requests.get(url, headers=headers, params=params, timeout=timeout)
    if 400 <= resp.status_code < 500:
        raise RuntimeError(f"http {resp.status_code}: {resp.text}")
    resp.raise_for_status()
    return resp.json()


def _string_similarity(a, b):
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _normalize_title_text(text):
    if not text:
        return ""
    cleaned = re.sub(r"\[[^\]]*\]", " ", text)
    cleaned = re.sub(r"\([^\)]*\)", " ", cleaned)
    cleaned = re.sub(r"\b(s\d{1,2}e\d{1,4}|ep\s*\d+|episode\s*\d+)\b", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"第\s*\d+\s*[话集]", " ", cleaned)
    cleaned = re.sub(r"[_\-.]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip().lower()


def _title_similarity(a, b):
    return _string_similarity(_normalize_title_text(a), _normalize_title_text(b))


def _alias_bonus(aliases, *titles):
    if not aliases:
        return 0.0
    alias_set = {_normalize_title_text(item) for item in aliases if item}
    for title in titles:
        if not title:
            continue
        if _normalize_title_text(title) in alias_set:
            return 0.2
    return 0.0


def _normalize_title_key(text):
    return re.sub(r"\s+", "", _normalize_title_text(text))


def _alias_match_score(aliases, title):
    if not aliases or not title:
        return 0.0
    allowed_suffixes = {
        "movie",
        "film",
        "ova",
        "special",
        "season",
        "part",
        "剧场版",
        "剧场",
        "电影",
        "篇",
        "篇章",
        "章",
    }
    title_key = _normalize_title_key(title)
    for alias in aliases:
        alias_key = _normalize_title_key(alias)
        if not alias_key:
            continue
        if title_key == alias_key:
            return 1.0
        if title_key.startswith(alias_key):
            remainder = title_key[len(alias_key) :]
        elif alias_key in title_key:
            remainder = title_key.replace(alias_key, "")
        else:
            continue
        remainder = remainder.strip()
        if not remainder:
            return 0.8
        if re.fullmatch(r"[0-9ivx]+", remainder):
            return 0.8
        if remainder in {_normalize_title_key(item) for item in allowed_suffixes}:
            return 0.8
    return 0.0


def _normalize_lang_for_asr(lang):
    norm = _normalize_lang(lang)
    if norm.startswith("jpn") or norm.startswith("ja"):
        return "ja"
    if norm.startswith("eng") or norm.startswith("en"):
        return "en"
    if norm.startswith("chi") or norm.startswith("zh"):
        return "zh"
    return norm or "auto"


def _is_japanese_text(text):
    return any("\u3040" <= ch <= "\u30ff" for ch in text)


def _is_cjk_text(text):
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def _is_english_text(text):
    return bool(re.search(r"[A-Za-z]", text))


def filter_hotwords_by_lang(hotwords, src_lang):
    if not hotwords:
        return []
    if ASR_HOTWORDS_ALLOW_MIXED and not LANGUAGE_HINTS:
        return hotwords
    lang = _normalize_lang_for_asr(src_lang)
    if not ASR_HOTWORDS_LANGS:
        return hotwords
    allowed = {_normalize_lang_for_asr(item) for item in ASR_HOTWORDS_LANGS}
    if lang not in allowed and lang != "auto":
        return []

    filtered = []
    for word in hotwords:
        if not word:
            continue
        if lang == "ja" and not _is_japanese_text(word):
            continue
        if lang == "zh" and not _is_cjk_text(word):
            continue
        if lang == "en" and not _is_english_text(word):
            continue
        filtered.append(word)
    return filtered or hotwords


def load_work_glossary_by_titles(titles):
    if not WORK_GLOSSARY_ENABLED or not WORK_GLOSSARY_DIR:
        return {}
    if not titles:
        return {}
    seen = set()
    for title in titles:
        slug = _slugify_title(title)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        for ext in (".yaml", ".yml"):
            path = os.path.join(WORK_GLOSSARY_DIR, f"{slug}{ext}")
            if not os.path.exists(path):
                continue
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                if isinstance(data, dict):
                    if isinstance(data.get("terms"), dict):
                        return data["terms"]
                    if isinstance(data.get("glossary"), dict):
                        return data["glossary"]
                    if all(isinstance(k, str) and isinstance(v, str) for k, v in data.items()):
                        return data
            except Exception:  # noqa: BLE001
                return {}
    return {}


def build_asr_hotwords(metadata, glossary, title_aliases, src_lang):
    if not ASR_HOTWORDS_ENABLED:
        return []
    hotwords = []

    if ASR_HOTWORDS_USE_TITLE_ALIASES and title_aliases:
        hotwords.extend(title_aliases)

    if ASR_HOTWORDS_USE_GLOSSARY and glossary:
        hotwords.extend(list(glossary.keys()))

    if ASR_HOTWORDS_USE_METADATA and metadata:
        for char in metadata.characters or []:
            name = char.get("nameOriginal")
            alias = _pick_alias(char.get("aliases", {}), src_lang)
            if name:
                hotwords.append(name)
            if alias:
                hotwords.append(alias)

    cleaned = []
    seen = set()
    for word in hotwords:
        word = sanitize_subtitle_text(str(word)).strip()
        if not word or word in seen:
            continue
        seen.add(word)
        cleaned.append(word)

    cleaned = filter_hotwords_by_lang(cleaned, src_lang)
    if ASR_HOTWORDS_MAX > 0:
        cleaned = cleaned[:ASR_HOTWORDS_MAX]
    return cleaned


def _hotword_lang_code(src_lang):
    lang = _normalize_lang_for_asr(src_lang)
    if lang in ("ja", "en", "zh"):
        return lang
    return None


def _is_ascii_text(text):
    return all(ord(ch) < 128 for ch in text)


def _valid_hotword_text(text):
    if not text:
        return False
    if _is_ascii_text(text):
        segments = [seg for seg in text.strip().split(" ") if seg]
        return len(segments) <= 7
    return len(text) <= 15


def _language_hints_allowed(lang):
    if not LANGUAGE_HINTS:
        return True
    hints = {_normalize_lang_for_asr(item) for item in LANGUAGE_HINTS}
    return lang in hints


def build_hotword_items(hotwords, src_lang):
    items = []
    lang = _hotword_lang_code(src_lang)
    if ASR_HOTWORDS_ALLOW_MIXED and not LANGUAGE_HINTS:
        lang = None
    if lang and not _language_hints_allowed(lang):
        return []
    weight = max(1, min(5, ASR_HOTWORDS_WEIGHT))
    for word in hotwords:
        if not _valid_hotword_text(word):
            continue
        item = {"text": word, "weight": weight}
        if lang:
            item["lang"] = lang
        items.append(item)
    return items


def create_vocabulary_id(hotwords, src_lang):
    if not hotwords:
        return None
    try:
        service = VocabularyService()
        vocabulary = build_hotword_items(hotwords, src_lang)
        target_model = ASR_HOTWORDS_TARGET_MODEL or ASR_MODEL
        vocab_id = service.create_vocabulary(
            prefix=ASR_HOTWORDS_PREFIX,
            target_model=target_model,
            vocabulary=vocabulary,
        )
        status = service.query_vocabulary(vocab_id).get("status")
        if status != "OK":
            return None
        return vocab_id
    except Exception as exc:  # noqa: BLE001
        log("WARN", "热词创建失败", error=str(exc))
        return None


def delete_vocabulary_id(vocab_id):
    if not vocab_id:
        return
    try:
        service = VocabularyService()
        service.delete_vocabulary(vocab_id)
    except Exception as exc:  # noqa: BLE001
        log("WARN", "热词删除失败", error=str(exc))

def load_title_aliases(path):
    if not path:
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not isinstance(data, dict):
            return {}
        aliases = {}
        for key, items in data.items():
            if not isinstance(items, list):
                continue
            aliases[key] = [str(item) for item in items if str(item).strip()]
        return aliases
    except FileNotFoundError:
        return {}
    except Exception:  # noqa: BLE001
        return {}


def _slugify_title(text):
    cleaned = _normalize_title_text(text)
    cleaned = re.sub(r"[^a-z0-9]+", "_", cleaned)
    cleaned = cleaned.strip("_")
    return cleaned or ""


def load_work_glossary(metadata):
    if not WORK_GLOSSARY_ENABLED or not WORK_GLOSSARY_DIR or not metadata:
        return {}
    titles = []
    if metadata.title_original:
        titles.append(metadata.title_original)
    for value in (metadata.title_localized or {}).values():
        titles.append(value)
    seen = set()
    for title in titles:
        slug = _slugify_title(title)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        for ext in (".yaml", ".yml"):
            path = os.path.join(WORK_GLOSSARY_DIR, f"{slug}{ext}")
            if not os.path.exists(path):
                continue
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                if isinstance(data, dict):
                    if isinstance(data.get("terms"), dict):
                        return data["terms"]
                    if isinstance(data.get("glossary"), dict):
                        return data["glossary"]
                    if all(isinstance(k, str) and isinstance(v, str) for k, v in data.items()):
                        return data
            except Exception:  # noqa: BLE001
                return {}
    return {}


def resolve_title_aliases(title, alias_map):
    if not title or not alias_map:
        return []
    candidates = set()
    normalized_title = _normalize_title_text(title)
    for key, values in alias_map.items():
        if _normalize_title_text(key) == normalized_title:
            candidates.update(values)
            candidates.add(key)
            break
        for value in values:
            if _normalize_title_text(value) == normalized_title:
                candidates.update(values)
                candidates.add(key)
                break
    candidates.discard(title)
    return sorted({item for item in candidates if item})


def _extract_year(date_value):
    if not date_value:
        return None
    match = re.search(r"(19|20)\d{2}", str(date_value))
    if not match:
        return None
    return int(match.group(0))


def _guess_type_from_path(path):
    name = os.path.basename(path)
    if re.search(r"[sS]\d{1,2}\s*[eE]\d{1,4}", name):
        return "tv"
    if re.search(r"\b(ep|episode)\s*\d{1,4}\b", name, re.I):
        return "tv"
    return "movie"


def _build_metadata_config():
    return MetadataConfig(
        enabled=METADATA_ENABLED,
        language_priority=METADATA_LANGUAGE_PRIORITY or ["en-US"],
        tmdb_enabled=TMDB_ENABLED,
        tmdb_api_key=TMDB_API_KEY,
        tmdb_base_url=TMDB_BASE_URL,
        bangumi_enabled=BANGUMI_ENABLED,
        bangumi_access_token=BANGUMI_ACCESS_TOKEN,
        bangumi_user_agent=BANGUMI_USER_AGENT,
        bangumi_base_url=BANGUMI_BASE_URL,
        wmdb_enabled=WMDB_ENABLED,
        wmdb_base_url=WMDB_BASE_URL,
        min_confidence=METADATA_MIN_CONFIDENCE,
        cache_ttl_seconds=METADATA_CACHE_TTL,
        provider_weights={
            "tmdb": PROVIDER_WEIGHT_TMDB,
            "bangumi": PROVIDER_WEIGHT_BANGUMI,
            "wmdb": PROVIDER_WEIGHT_WMDB,
        },
        debug=METADATA_DEBUG,
    )


def _build_work_query(
    video_path,
    work_info,
    subtitle_snippets,
    language_priority,
    title_aliases,
    nfo_info=None,
    nfo_path=None,
):
    raw_file_name = os.path.basename(video_path)
    directory_names = [
        name for name in os.path.normpath(os.path.dirname(video_path)).split(os.sep) if name
    ]
    guessed_title = work_info.title if work_info and work_info.title else None
    guessed_season = int(work_info.season) if work_info and work_info.season else None
    guessed_episode = int(work_info.episode) if work_info and work_info.episode else None
    guessed_year = None
    year_match = re.search(r"(19|20)\d{2}", raw_file_name)
    if year_match:
        guessed_year = int(year_match.group(0))
    guessed_type = _guess_type_from_path(video_path)
    if guessed_season is not None or guessed_episode is not None:
        guessed_type = "tv"
    external_ids = {}
    nfo_title = None
    nfo_original_title = None
    nfo_episode_title = None
    if nfo_info:
        nfo_title = nfo_info.get("title")
        nfo_original_title = nfo_info.get("original_title")
        nfo_episode_title = nfo_info.get("episode_title")
        if nfo_title:
            guessed_title = nfo_title
        if nfo_info.get("season") is not None:
            guessed_season = nfo_info.get("season")
        if nfo_info.get("episode") is not None:
            guessed_episode = nfo_info.get("episode")
        if nfo_info.get("year") is not None:
            guessed_year = nfo_info.get("year")
        if nfo_info.get("type"):
            guessed_type = nfo_info.get("type")
        external_ids = dict(nfo_info.get("external_ids") or {})
    return WorkQuery(
        raw_file_name=raw_file_name,
        directory_names=directory_names,
        container_title=None,
        guessed_title=guessed_title,
        title_aliases=title_aliases,
        guessed_season=guessed_season,
        guessed_episode=guessed_episode,
        guessed_year=guessed_year,
        guessed_type=guessed_type,
        subtitle_snippets=subtitle_snippets,
        language_priority=language_priority,
        nfo_path=nfo_path,
        nfo_title=nfo_title,
        nfo_original_title=nfo_original_title,
        nfo_episode_title=nfo_episode_title,
        external_ids=external_ids,
    )


def refine_work_aliases_via_llm(path_info, sample_lines, llm_client, path=""):
    if llm_client is None:
        return []
    lines = [line for line in sample_lines if line.strip()][:30]
    system_prompt = (
        "你是一个负责识别影视作品别名的助手。"
        "请根据文件路径与字幕片段，给出该作品可能的中/日/英标题别名。"
        "返回严格 JSON，不要解释。"
    )
    user_prompt = (
        "文件路径：\n"
        f"{path}\n\n"
        "初步推断：\n"
        f"title = {json.dumps(path_info.title, ensure_ascii=False)}\n"
        f"season = {json.dumps(path_info.season, ensure_ascii=False)}\n"
        f"episode = {json.dumps(path_info.episode, ensure_ascii=False)}\n\n"
        "字幕片段：\n"
        + "\n".join(lines)
        + "\n\n"
        "请输出 JSON，例如：\n"
        '{ "aliases": ["ワンピース", "ONE PIECE", "海贼王"] }'
    )
    prompt = f"[system]\n{system_prompt}\n\n[user]\n{user_prompt}"
    try:
        raw = llm_client(prompt)
        data = json.loads(raw)
        aliases = data.get("aliases") if isinstance(data, dict) else []
        if not isinstance(aliases, list):
            return []
        return [str(item) for item in aliases if str(item).strip()]
    except Exception:  # noqa: BLE001
        return []


class TmdbProvider:
    name = "tmdb"

    def resolve(self, query, config):
        if not config.tmdb_enabled or not config.tmdb_api_key:
            return None
        titles = [query.guessed_title] if query.guessed_title else []
        titles.extend(query.title_aliases or [])
        titles.append(query.raw_file_name)
        titles = [item for item in titles if item]
        if not titles:
            return None
        search_type = query.guessed_type or _guess_type_from_path(query.raw_file_name)
        endpoint = "tv" if search_type == "tv" else "movie"
        base_url = config.tmdb_base_url.rstrip("/")

        best = None
        best_score = 0.0
        best_lang = None
        for title in titles[:3]:
            for lang in config.language_priority[:3]:
                try:
                    data = _safe_get_json(
                        f"{base_url}/search/{endpoint}",
                        params={
                            "api_key": config.tmdb_api_key,
                            "language": lang,
                            "query": title,
                            "first_air_date_year": query.guessed_year if endpoint == "tv" else None,
                            "year": query.guessed_year if endpoint == "movie" else None,
                        },
                    )
                except Exception:
                    continue
                results = data.get("results") if isinstance(data, dict) else None
                if not results:
                    continue
                for item in results[:10]:
                    name = item.get("name") or item.get("title") or ""
                    original = item.get("original_name") or item.get("original_title") or ""
                    date = item.get("first_air_date") or item.get("release_date")
                    if query.title_aliases:
                        alias_score = max(
                            _alias_match_score(query.title_aliases, name),
                            _alias_match_score(query.title_aliases, original),
                        )
                        if alias_score == 0.0:
                            continue
                    else:
                        alias_score = 0.0
                    score = _title_similarity(title, name) * 0.7 + _title_similarity(title, original) * 0.2
                    score += _alias_bonus(query.title_aliases, name, original) + alias_score * 0.3
                    year = _extract_year(date)
                    if query.guessed_year and year:
                        if abs(query.guessed_year - year) <= 1:
                            score += 0.1
                    if (
                        query.guessed_episode
                        and year
                        and query.guessed_episode >= 50
                        and year < 1990
                    ):
                        score -= 0.3
                    if score > best_score:
                        best_score = score
                        best = item
                        best_lang = lang
        if not best:
            return None
        if best_score < METADATA_MIN_TITLE_SIMILARITY:
            return None

        tmdb_id = best.get("id")
        if not tmdb_id:
            return None

        episode_title = {}
        if endpoint == "tv" and query.guessed_season and query.guessed_episode:
            try:
                episode = _safe_get_json(
                    f"{base_url}/tv/{tmdb_id}/season/{query.guessed_season}/episode/{query.guessed_episode}",
                    params={"api_key": config.tmdb_api_key, "language": best_lang or "en-US"},
                )
                if isinstance(episode, dict):
                    name = episode.get("name")
                    if name:
                        episode_title[best_lang or "en-US"] = name
            except Exception:
                pass

        title_original = best.get("original_name") or best.get("original_title")
        title_localized = {}
        if best_lang:
            name = best.get("name") or best.get("title")
            if name:
                title_localized[best_lang] = name

        year = _extract_year(best.get("first_air_date") or best.get("release_date"))
        return WorkMetadata(
            title_original=title_original,
            title_localized=title_localized,
            type=endpoint,
            year=year,
            season=query.guessed_season,
            episode=query.guessed_episode,
            episode_title=episode_title,
            characters=[],
            external_ids={"tmdb": tmdb_id},
            confidence=max(0.0, min(best_score, 1.0)),
            sources=[self.name],
            raw={"tmdb": best},
        )


class BangumiProvider:
    name = "bangumi"

    def resolve(self, query, config):
        if not config.bangumi_enabled or not config.bangumi_user_agent:
            return None
        keywords = [query.guessed_title] if query.guessed_title else []
        keywords.extend(query.title_aliases or [])
        keywords.append(query.raw_file_name)
        keywords = [item for item in keywords if item]
        if not keywords:
            return None
        headers = {"User-Agent": config.bangumi_user_agent}
        if config.bangumi_access_token:
            headers["Authorization"] = f"Bearer {config.bangumi_access_token}"

        best = None
        best_score = 0.0
        for keyword in keywords[:3]:
            try:
                data = _safe_get_json(
                    f"{config.bangumi_base_url.rstrip('/')}/search/subject/{requests.utils.quote(keyword)}",
                    headers=headers,
                    params={"type": 2, "responseGroup": "small", "max_results": 10},
                )
            except Exception:
                continue

            results = data.get("list") if isinstance(data, dict) else None
            if not results:
                continue

            for item in results:
                name = item.get("name") or ""
                name_cn = item.get("name_cn") or ""
                if query.title_aliases:
                    alias_score = max(
                        _alias_match_score(query.title_aliases, name),
                        _alias_match_score(query.title_aliases, name_cn),
                    )
                    if alias_score == 0.0:
                        continue
                else:
                    alias_score = 0.0
                score = max(_title_similarity(keyword, name), _title_similarity(keyword, name_cn))
                score += _alias_bonus(query.title_aliases, name, name_cn) + alias_score * 0.3
                year = _extract_year(item.get("date"))
                if (
                    query.guessed_episode
                    and year
                    and query.guessed_episode >= 50
                    and year < 1990
                ):
                    score -= 0.3
                if score > best_score:
                    best_score = score
                    best = item
        if not best:
            return None
        if best_score < METADATA_MIN_TITLE_SIMILARITY:
            return None

        subject_id = best.get("id")
        detail = {}
        try:
            detail = _safe_get_json(
                f"{config.bangumi_base_url.rstrip('/')}/v0/subjects/{subject_id}",
                headers=headers,
            )
        except Exception:
            try:
                detail = _safe_get_json(
                    f"{config.bangumi_base_url.rstrip('/')}/subject/{subject_id}",
                    headers=headers,
                )
            except Exception:
                detail = {}

        title_original = detail.get("name") or best.get("name")
        title_localized = {}
        if detail.get("name_cn"):
            title_localized["zh-CN"] = detail.get("name_cn")

        characters = []
        try:
            char_data = _safe_get_json(
                f"{config.bangumi_base_url.rstrip('/')}/v0/subjects/{subject_id}/characters",
                headers=headers,
            )
            for item in char_data.get("data", [])[:50]:
                name = item.get("name")
                name_cn = item.get("name_cn")
                aliases = {}
                if name_cn:
                    aliases["zh-CN"] = name_cn
                if name:
                    characters.append({"nameOriginal": name, "aliases": aliases})
        except Exception:
            pass

        year = _extract_year(detail.get("date") or best.get("date"))
        if (
            query.guessed_episode
            and year
            and query.guessed_episode >= 50
            and year < 1990
        ):
            return None
        return WorkMetadata(
            title_original=title_original,
            title_localized=title_localized,
            type=query.guessed_type or "tv",
            year=year,
            season=query.guessed_season,
            episode=query.guessed_episode,
            episode_title={},
            characters=characters,
            external_ids={"bangumi": subject_id},
            confidence=max(0.0, min(best_score, 1.0)),
            sources=[self.name],
            raw={"bangumi": detail or best},
        )


class WmdbProvider:
    name = "wmdb"

    def resolve(self, query, config):
        if not config.wmdb_enabled:
            return None
        keywords = [query.guessed_title] if query.guessed_title else []
        keywords.extend(query.title_aliases or [])
        keywords.append(query.raw_file_name)
        keywords = [item for item in keywords if item]
        if not keywords:
            return None
        base_url = config.wmdb_base_url.rstrip("/")
        best = None
        best_score = 0.0
        for keyword in keywords[:3]:
            try:
                data = _safe_get_json(f"{base_url}/api/search", params={"q": keyword})
            except Exception:
                continue
            items = data.get("data") if isinstance(data, dict) else None
            if not items:
                continue
            candidate = items[0]
            title = candidate.get("name") or candidate.get("originalName")
            if query.title_aliases:
                alias_score = _alias_match_score(query.title_aliases, title)
                if alias_score == 0.0:
                    continue
            else:
                alias_score = 0.0
            score = _title_similarity(keyword, title)
            score += alias_score * 0.3
            if score > best_score:
                best_score = score
                best = candidate
        if not best:
            return None
        title = best.get("name") or best.get("originalName")
        year = _extract_year(best.get("year"))
        score = best_score
        external_ids = {}
        if best.get("doubanId"):
            external_ids["wmdbDoubanId"] = best.get("doubanId")
        if best.get("imdbId"):
            external_ids["imdb"] = best.get("imdbId")
        return WorkMetadata(
            title_original=best.get("originalName") or title,
            title_localized={"zh-CN": best.get("name")} if best.get("name") else {},
            type=query.guessed_type or "unknown",
            year=year,
            season=query.guessed_season,
            episode=query.guessed_episode,
            episode_title={},
            characters=[],
            external_ids=external_ids,
            confidence=max(0.0, min(score, 1.0)),
            sources=[self.name],
            raw={"wmdb": best},
        )


class MetadataService:
    def __init__(self, config):
        self.config = config
        self.cache = {}
        self.lock = threading.Lock()
        self.providers = [
            TmdbProvider(),
            BangumiProvider(),
            WmdbProvider(),
        ]

    def _cache_key(self, query):
        payload = {
            "raw": query.raw_file_name,
            "dirs": query.directory_names,
            "title": query.guessed_title,
            "season": query.guessed_season,
            "episode": query.guessed_episode,
            "year": query.guessed_year,
            "type": query.guessed_type,
            "nfo_title": query.nfo_title,
            "nfo_original_title": query.nfo_original_title,
            "external_ids": query.external_ids,
        }
        return hashlib.sha256(json.dumps(payload, ensure_ascii=False).encode("utf-8")).hexdigest()

    def resolve_work(self, query):
        if not self.config.enabled:
            return None
        key = self._cache_key(query)
        now = time.time()
        with self.lock:
            cached = self.cache.get(key)
            if cached and now - cached["ts"] < self.config.cache_ttl_seconds:
                return cached["value"]

        results = []
        for provider in self.providers:
            if provider.name == "tmdb" and not self.config.tmdb_enabled:
                continue
            if provider.name == "bangumi" and not self.config.bangumi_enabled:
                continue
            if provider.name == "wmdb" and not self.config.wmdb_enabled:
                continue
            try:
                result = provider.resolve(query, self.config)
            except Exception as exc:  # noqa: BLE001
                log("WARN", "元数据源失败", provider=provider.name, error=str(exc))
                result = None
            if result:
                results.append(result)

        if not results:
            return None

        merged = merge_work_metadata(results, self.config)
        with self.lock:
            self.cache[key] = {"ts": now, "value": merged}
        return merged


def merge_work_metadata(results, config):
    weights = config.provider_weights
    weighted = [
        (meta, weights.get(meta.sources[0], 1.0) * meta.confidence) for meta in results
    ]
    weighted.sort(key=lambda item: item[1], reverse=True)
    primary = weighted[0][0]
    total_weight = sum(weight for _meta, weight in weighted) or 1.0
    confidence = sum(weight for _meta, weight in weighted) / total_weight

    title_localized = dict(primary.title_localized or {})
    for meta, _weight in weighted[1:]:
        for lang, title in (meta.title_localized or {}).items():
            title_localized.setdefault(lang, title)

    characters = []
    seen_names = set()
    for meta, _weight in weighted:
        for char in meta.characters or []:
            name = char.get("nameOriginal")
            if not name or name in seen_names:
                continue
            seen_names.add(name)
            characters.append(char)

    external_ids = {}
    for meta, _weight in weighted:
        external_ids.update(meta.external_ids or {})

    merged = WorkMetadata(
        title_original=primary.title_original,
        title_localized=title_localized,
        type=primary.type,
        year=primary.year,
        season=primary.season,
        episode=primary.episode,
        episode_title=primary.episode_title or {},
        characters=characters,
        external_ids=external_ids,
        confidence=max(0.0, min(confidence, 1.0)),
        sources=[meta.sources[0] for meta, _weight in weighted],
        raw={meta.sources[0]: meta.raw.get(meta.sources[0]) for meta, _weight in weighted},
    )
    if merged.confidence < config.min_confidence:
        return None
    return merged


def _pick_alias(aliases, dst_lang):
    if not aliases:
        return None
    norm_dst = _normalize_lang(dst_lang)
    for key, value in aliases.items():
        if _normalize_lang(key).startswith(norm_dst):
            return value
    for key in ("zh-cn", "zh", "zh-hans"):
        for alias_lang, value in aliases.items():
            if _normalize_lang(alias_lang).startswith(key):
                return value
    return None


def build_metadata_glossary(metadata, dst_lang):
    if not metadata:
        return {}
    glossary = {}
    for char in metadata.characters or []:
        name = char.get("nameOriginal")
        alias = _pick_alias(char.get("aliases", {}), dst_lang)
        if name and alias:
            glossary[name] = alias
    return glossary


def format_metadata_context(metadata, dst_lang):
    if not metadata:
        return ""
    lines = []
    title_parts = []
    if metadata.title_original:
        title_parts.append(metadata.title_original)
    if metadata.title_localized:
        for lang, title in metadata.title_localized.items():
            title_parts.append(f"{lang}: {title}")
    if title_parts:
        lines.append("作品标题：" + " / ".join(title_parts))
    if metadata.season or metadata.episode:
        lines.append(
            f"集数信息：S{metadata.season or '?'}E{metadata.episode or '?'}"
        )
    if metadata.episode_title:
        for lang, title in metadata.episode_title.items():
            lines.append(f"本集标题({lang})：{title}")
    glossary = build_metadata_glossary(metadata, dst_lang)
    if glossary:
        lines.append("主要角色与译名：")
        for key, value in list(glossary.items())[:20]:
            lines.append(f"- {key} => {value}")
    return "\n".join(lines)


def extract_sentences(asr_result):
    output = asr_result.get("output", asr_result)
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
        return []

    transcripts = result.get("transcripts")
    if isinstance(transcripts, list) and transcripts:
        result = transcripts[0]

    sentences = result.get("sentences") or result.get("sentence_list") or []
    if not isinstance(sentences, list):
        return []

    def _first_not_none(*values):
        for value in values:
            if value is not None:
                return value
        return None

    normalized = []
    for item in sentences:
        if not isinstance(item, dict):
            continue
        words = item.get("words") or item.get("word_list") or []
        if not isinstance(words, list):
            words = []
        normalized.append(
            {
                "begin_time": _first_not_none(
                    item.get("begin_time"), item.get("start_time"), item.get("start")
                ),
                "end_time": _first_not_none(item.get("end_time"), item.get("end")),
                "text": item.get("text") or item.get("sentence") or item.get("transcription") or "",
                "words": [
                    {
                        "begin_time": _first_not_none(
                            w.get("begin_time"), w.get("start_time"), w.get("start")
                        ),
                        "end_time": _first_not_none(w.get("end_time"), w.get("end")),
                        "text": w.get("text") or w.get("word") or "",
                        "punctuation": w.get("punctuation") or "",
                    }
                    for w in words
                    if isinstance(w, dict)
                ],
            }
        )
    return normalized


def segment_sentences_to_subtitles(sentences, max_duration_seconds, max_chars):
    segments = []
    break_punct = {"。", "！", "？", "!", "?"}

    for sentence in sentences:
        words = sentence.get("words") or []
        if words:
            buffer = []
            start_ms = None
            end_ms = None
            for word in words:
                token = f"{word.get('text', '')}{word.get('punctuation', '')}".strip()
                if not token:
                    continue
                word_start = word.get("begin_time")
                word_end = word.get("end_time")
                if word_start is None or word_end is None:
                    continue
                if start_ms is None:
                    start_ms = int(word_start)
                end_ms = int(word_end)
                buffer.append(token)

                text = "".join(buffer).strip()
                duration = (end_ms - start_ms) / 1000.0 if start_ms is not None else 0.0
                should_break = (
                    duration > max_duration_seconds
                    or len(text) > max_chars
                    or word.get("punctuation") in break_punct
                )
                if should_break and text:
                    segments.append(
                        {
                            "start_ms": start_ms,
                            "end_ms": end_ms,
                            "text": text,
                        }
                    )
                    buffer = []
                    start_ms = None
                    end_ms = None

            if buffer and start_ms is not None and end_ms is not None:
                text = "".join(buffer).strip()
                if text:
                    segments.append(
                        {
                            "start_ms": start_ms,
                            "end_ms": end_ms,
                            "text": text,
                        }
                    )
            continue

        begin = sentence.get("begin_time")
        end = sentence.get("end_time")
        text = sentence.get("text") or ""
        if begin is None or end is None or not text.strip():
            continue
        begin = int(begin)
        end = int(end)
        text = text.strip()
        duration = (end - begin) / 1000.0
        if duration <= max_duration_seconds and len(text) <= max_chars:
            segments.append(
                {
                    "start_ms": begin,
                    "end_ms": end,
                    "text": text,
                }
            )
            continue

        chunk_count = max(1, int(len(text) / max_chars) + 1)
        chunk_count = max(chunk_count, int(duration / max_duration_seconds) + 1)
        if chunk_count <= 0:
            chunk_count = 1
        time_span = max(1, end - begin)
        chunk_size = max(1, len(text) // chunk_count)
        for i in range(chunk_count):
            start_idx = i * chunk_size
            end_idx = len(text) if i == chunk_count - 1 else (i + 1) * chunk_size
            chunk_text = text[start_idx:end_idx].strip()
            if not chunk_text:
                continue
            chunk_start = begin + int(time_span * i / chunk_count)
            chunk_end = begin + int(time_span * (i + 1) / chunk_count)
            segments.append(
                {
                    "start_ms": chunk_start,
                    "end_ms": chunk_end,
                    "text": chunk_text,
                }
            )

    cleaned = []
    for seg in segments:
        text = sanitize_subtitle_text(seg["text"]).strip()
        if not text:
            continue
        cleaned.append(
            {
                "start_ms": int(seg["start_ms"]),
                "end_ms": int(seg["end_ms"]),
                "text": text,
            }
        )
    return cleaned


def _merge_text(lhs, rhs):
    if not lhs:
        return rhs
    if not rhs:
        return lhs
    if _is_cjk_text(lhs + rhs) or _is_japanese_text(lhs + rhs):
        return f"{lhs}{rhs}"
    return f"{lhs} {rhs}"


def merge_short_segments(
    segments,
    min_duration_seconds,
    min_chars,
    max_duration_seconds,
    max_chars,
    max_gap_ms,
):
    if not segments:
        return []
    merged = []
    merge_max_duration = max_duration_seconds * 1.3
    merge_max_chars = int(max_chars * 1.3)
    i = 0
    while i < len(segments):
        seg = segments[i]
        duration = (seg["end_ms"] - seg["start_ms"]) / 1000.0
        is_short = duration < min_duration_seconds or len(seg["text"]) < min_chars
        if not is_short:
            merged.append(seg)
            i += 1
            continue

        merged_flag = False
        if i + 1 < len(segments):
            nxt = segments[i + 1]
            gap = nxt["start_ms"] - seg["end_ms"]
            combined_text = _merge_text(seg["text"], nxt["text"])
            combined_duration = (nxt["end_ms"] - seg["start_ms"]) / 1000.0
            if (
                gap <= max_gap_ms
                and combined_duration <= merge_max_duration
                and len(combined_text) <= merge_max_chars
            ):
                merged.append(
                    {
                        "start_ms": seg["start_ms"],
                        "end_ms": nxt["end_ms"],
                        "text": combined_text,
                    }
                )
                i += 2
                merged_flag = True
        if merged_flag:
            continue

        if merged:
            prev = merged.pop()
            gap = seg["start_ms"] - prev["end_ms"]
            combined_text = _merge_text(prev["text"], seg["text"])
            combined_duration = (seg["end_ms"] - prev["start_ms"]) / 1000.0
            if (
                gap <= max_gap_ms
                and combined_duration <= merge_max_duration
                and len(combined_text) <= merge_max_chars
            ):
                merged.append(
                    {
                        "start_ms": prev["start_ms"],
                        "end_ms": seg["end_ms"],
                        "text": combined_text,
                    }
                )
                i += 1
                continue
            merged.append(prev)

        merged.append(seg)
        i += 1
    return merged


def assign_indices(segments):
    out = []
    for idx, seg in enumerate(segments, start=1):
        item = dict(seg)
        item["index"] = idx
        out.append(item)
    return out


def validate_and_fix_subs(subs):
    issues = []
    fixed = []
    prev_end = None
    for sub in subs:
        content = (sub.content or "").strip()
        if not content:
            issues.append("empty_content")
            continue
        start = sub.start
        end = sub.end
        if end <= start:
            issues.append("end_before_start")
            end = start + timedelta(milliseconds=500)
        if start.total_seconds() < 0:
            issues.append("negative_start")
            start = timedelta(seconds=0)
        if prev_end and start < prev_end:
            issues.append("overlap")
            duration = end - start
            start = prev_end
            end = start + duration
        prev_end = end
        fixed.append(
            srt.Subtitle(
                index=len(fixed) + 1,
                start=start,
                end=end,
                content=content,
            )
        )
    return fixed, issues


def rate_limit(key, rps):
    if not rps or rps <= 0:
        return
    interval = 1.0 / rps
    now = time.monotonic()
    wait = 0.0
    with _RATE_LIMIT_LOCK:
        next_time = _RATE_LIMIT_STATE.get(key, 0.0)
        if now < next_time:
            wait = next_time - now
            _RATE_LIMIT_STATE[key] = next_time + interval
        else:
            _RATE_LIMIT_STATE[key] = now + interval
    if wait > 0:
        time.sleep(wait)


def ms_to_srt_timestamp(ms):
    if ms < 0:
        ms = 0
    hours, rem = divmod(ms, 3600000)
    minutes, rem = divmod(rem, 60000)
    seconds, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def segments_to_srt(segments):
    lines = []
    for seg in segments:
        lines.append(str(seg["index"]))
        lines.append(
            f"{ms_to_srt_timestamp(seg['start_ms'])} --> {ms_to_srt_timestamp(seg['end_ms'])}"
        )
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def post_process_asr_result(
    asr_result,
    max_duration_seconds=3.5,
    max_chars=25,
    min_duration_seconds=1.0,
    min_chars=6,
    merge_gap_ms=400,
):
    sentences = extract_sentences(asr_result)
    segments = segment_sentences_to_subtitles(sentences, max_duration_seconds, max_chars)
    segments = merge_short_segments(
        segments,
        min_duration_seconds,
        min_chars,
        max_duration_seconds,
        max_chars,
        merge_gap_ms,
    )
    return assign_indices(segments)


def get_media_duration(path):
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    try:
        output = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True).strip()
        if not output:
            return None
        return float(output)
    except Exception:  # noqa: BLE001
        return None


def list_embedded_subtitles(video_path):
    info = probe_media(video_path)
    results = []
    for track in info.subtitle_tracks:
        results.append(
            {
                "kind": "embedded",
                "stream_index": track.index,
                "language": track.language,
                "title": track.title,
                "codec": track.codec,
                "is_default": track.is_default,
                "is_forced": track.is_forced,
                "is_image_based": track.is_image_based,
            }
        )
    return results


def list_external_subtitles(video_path):
    folder = os.path.dirname(video_path)
    base = os.path.splitext(os.path.basename(video_path))[0]
    results = []
    try:
        for name in os.listdir(folder):
            ext = os.path.splitext(name)[1].lower()
            if ext not in SUBTITLE_EXTS:
                continue
            stem = os.path.splitext(name)[0]
            if stem == base or stem.startswith(f"{base}."):
                lang_guess = guess_lang_from_label(name)
                results.append(
                    {
                        "kind": "external",
                        "path": os.path.join(folder, name),
                        "name": name,
                        "language": lang_guess,
                    }
                )
    except FileNotFoundError:
        return []
    return results


def _guess_variant_from_text(text):
    if not text:
        return None
    cjk = [ch for ch in text if "\u4e00" <= ch <= "\u9fff"]
    if not cjk:
        return None
    has_kana = any("\u3040" <= ch <= "\u30ff" for ch in text)
    if has_kana:
        return "unknown"
    trad_hits = sum(1 for ch in cjk if ch in TRADITIONAL_CHARS)
    if trad_hits >= 2:
        return "traditional"
    simp_hits = sum(1 for ch in cjk if ch in SIMPLIFIED_HINT_CHARS)
    if simp_hits >= 2:
        return "simplified"
    return "unknown"


def _guess_variant_from_label(text):
    if not text:
        return None
    lower = text.lower()
    if SIMPLIFIED_LANG and f".llm.{SIMPLIFIED_LANG}" in lower:
        return "simplified"
    if SIMPLIFIED_LANG and f".{SIMPLIFIED_LANG}" in lower:
        return "simplified"
    if any(token in lower for token in SIMPLIFIED_TOKENS):
        return "simplified"
    if any(token in lower for token in TRADITIONAL_TOKENS):
        return "traditional"
    if any(token in lower for token in ("zh", "chi", "zho", "chinese")):
        return "chinese"
    return None


def _sample_subtitle_text(path):
    data = read_text_file(path)[:4000]
    data = re.sub(r"\{[^}]*\}", " ", data)
    data = re.sub(r"<[^>]*>", " ", data)
    data = re.sub(r"\s+", " ", data)
    return data


def _normalize_lang_tag(lang):
    if not lang:
        return ""
    value = lang.strip().lower().replace("_", "-")
    base = value.split("-")[0]
    mapping = {
        "jpn": "ja",
        "ja": "ja",
        "japanese": "ja",
        "chi": "zh",
        "zho": "zh",
        "zh": "zh",
        "cn": "zh",
        "eng": "en",
        "en": "en",
        "english": "en",
    }
    return mapping.get(base, base)


def _estimate_lang_confidence(text, lang):
    if not text or not lang:
        return 0.0
    counts = {"han": 0, "kana": 0, "latin": 0}
    for ch in text:
        code = ord(ch)
        if 0x3040 <= code <= 0x30FF:
            counts["kana"] += 1
        elif 0x4E00 <= code <= 0x9FFF:
            counts["han"] += 1
        elif ("A" <= ch <= "Z") or ("a" <= ch <= "z"):
            counts["latin"] += 1
    total = counts["han"] + counts["kana"] + counts["latin"]
    if total == 0:
        return 0.0
    if lang == "ja":
        return (counts["kana"] + counts["han"] * 0.4) / total
    if lang == "zh":
        return counts["han"] / total
    if lang == "en":
        return counts["latin"] / total
    return 0.0


def _select_reuse_confidence(text, lang_hints):
    candidates = []
    for hint in lang_hints:
        normalized = _normalize_lang_tag(hint)
        if normalized:
            candidates.append(normalized)
    if not candidates:
        candidates = ["ja", "zh", "en"]
    confidences = [
        _estimate_lang_confidence(text, lang) for lang in dict.fromkeys(candidates)
    ]
    return max(confidences) if confidences else 0.0


def describe_subtitle_variant(subtitle_info, video_path=None):
    if subtitle_info.get("kind") == "external":
        name = subtitle_info.get("name", "")
        variant = _guess_variant_from_label(name)
        if variant in ("simplified", "traditional"):
            return variant
        text = _sample_subtitle_text(subtitle_info.get("path"))
        variant = _guess_variant_from_text(text)
        return variant or "unknown"

    lang = subtitle_info.get("language") or ""
    title = subtitle_info.get("title") or ""
    variant = _guess_variant_from_label(f"{lang} {title}")
    if variant in ("simplified", "traditional"):
        return variant
    if video_path and variant in ("chinese", None):
        tmp_path = os.path.join(TMP_DIR, f"probe-{uuid.uuid4().hex}.srt")
        try:
            ffmpeg_extract_subtitle(video_path, subtitle_info["stream_index"], tmp_path)
            text = _sample_subtitle_text(tmp_path)
            variant = _guess_variant_from_text(text)
            return variant or "unknown"
        except Exception:  # noqa: BLE001
            return "unknown"
        finally:
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass
    return "unknown"


def inspect_existing_subtitles(video_path):
    external = list_external_subtitles(video_path)
    embedded = list_embedded_subtitles(video_path)

    for info in external:
        info["variant"] = describe_subtitle_variant(info)
    for info in embedded:
        info["variant"] = describe_subtitle_variant(info, video_path=video_path)

    simplified = [info for info in external + embedded if info.get("variant") == "simplified"]
    traditional = [info for info in external + embedded if info.get("variant") == "traditional"]
    others = [
        info
        for info in external + embedded
        if info.get("variant") not in ("simplified", "traditional")
    ]
    return simplified, traditional, others


def load_subtitles_from_source(video_path, subtitle_info):
    tmp_srt = os.path.join(TMP_DIR, f"subtitle-{uuid.uuid4().hex}.srt")
    if subtitle_info.get("kind") == "external":
        src = subtitle_info.get("path")
        if src and src.lower().endswith(".srt"):
            shutil.copyfile(src, tmp_srt)
        else:
            ffmpeg_convert_subtitle(src, tmp_srt)
    else:
        ffmpeg_extract_subtitle(video_path, subtitle_info["stream_index"], tmp_srt)

    text = read_text_file(tmp_srt)
    subs = list(srt.parse(text))
    for sub in subs:
        sub.content = sanitize_subtitle_text(sub.content)
    return subs, srt.compose(subs), tmp_srt


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


def dashscope_transcribe(url, hotwords=None, vocabulary_id=None):
    dashscope.api_key = DASHSCOPE_API_KEY

    def _call():
        rate_limit("dashscope", DASHSCOPE_RPS)
        kwargs = {"model": ASR_MODEL, "file_urls": [url]}
        if ASR_MODEL == "paraformer-v2" and LANGUAGE_HINTS:
            kwargs["language_hints"] = LANGUAGE_HINTS
        if vocabulary_id:
            kwargs["vocabulary_id"] = vocabulary_id
        elif hotwords:
            kwargs[ASR_HOTWORDS_PARAM] = hotwords
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


def dashscope_realtime_transcribe(
    path,
    vocabulary_id=None,
    semantic_punctuation_enabled=None,
    max_sentence_silence=None,
    multi_threshold_mode_enabled=None,
):
    dashscope.api_key = DASHSCOPE_API_KEY

    rate_limit("dashscope", DASHSCOPE_RPS)
    kwargs = {
        "model": ASR_MODEL,
        "format": "wav",
        "sample_rate": ASR_SAMPLE_RATE,
        "callback": None,
        "semantic_punctuation_enabled": (
            ASR_SEMANTIC_PUNCTUATION_ENABLED
            if semantic_punctuation_enabled is None
            else semantic_punctuation_enabled
        ),
        "max_sentence_silence": (
            ASR_MAX_SENTENCE_SILENCE if max_sentence_silence is None else max_sentence_silence
        ),
        "multi_threshold_mode_enabled": (
            ASR_MULTI_THRESHOLD_MODE_ENABLED
            if multi_threshold_mode_enabled is None
            else multi_threshold_mode_enabled
        ),
        "punctuation_prediction_enabled": ASR_PUNCTUATION_PREDICTION_ENABLED,
        "disfluency_removal_enabled": ASR_DISFLUENCY_REMOVAL_ENABLED,
        "heartbeat": ASR_HEARTBEAT,
    }
    if ASR_MODEL == "paraformer-realtime-v2" and LANGUAGE_HINTS:
        kwargs["language_hints"] = LANGUAGE_HINTS
    if vocabulary_id:
        kwargs["vocabulary_id"] = vocabulary_id
    recognition = Recognition(**kwargs)

    def _call():
        response = recognition.call(path)
        error = extract_dashscope_error(response)
        if error:
            raise RuntimeError(error)
        return response

    return retry(_call)


class _StreamingCollector(RecognitionCallback):
    def __init__(self):
        self.sentences = []
        self.lock = threading.Lock()
        self.completed = threading.Event()
        self.errors = []

    def on_open(self) -> None:
        return None

    def on_event(self, result) -> None:
        sentence = result.get_sentence()
        if not isinstance(sentence, dict):
            return None
        is_end = False
        try:
            is_end = result.is_sentence_end(sentence)
        except Exception:  # noqa: BLE001
            is_end = False
        if not is_end and not sentence.get("text"):
            return None
        with self.lock:
            self.sentences.append(sentence)
        return None

    def on_complete(self) -> None:
        self.completed.set()

    def on_error(self, result) -> None:
        with self.lock:
            self.errors.append(str(result))
        self.completed.set()

    def on_close(self) -> None:
        self.completed.set()


def dashscope_realtime_streaming_transcribe(
    path,
    vocabulary_id=None,
    semantic_punctuation_enabled=None,
    max_sentence_silence=None,
    multi_threshold_mode_enabled=None,
):
    dashscope.api_key = DASHSCOPE_API_KEY

    rate_limit("dashscope", DASHSCOPE_RPS)
    callback = _StreamingCollector()
    kwargs = {
        "model": ASR_MODEL,
        "format": "wav",
        "sample_rate": ASR_SAMPLE_RATE,
        "callback": callback,
        "semantic_punctuation_enabled": (
            ASR_SEMANTIC_PUNCTUATION_ENABLED
            if semantic_punctuation_enabled is None
            else semantic_punctuation_enabled
        ),
        "max_sentence_silence": (
            ASR_MAX_SENTENCE_SILENCE if max_sentence_silence is None else max_sentence_silence
        ),
        "multi_threshold_mode_enabled": (
            ASR_MULTI_THRESHOLD_MODE_ENABLED
            if multi_threshold_mode_enabled is None
            else multi_threshold_mode_enabled
        ),
        "punctuation_prediction_enabled": ASR_PUNCTUATION_PREDICTION_ENABLED,
        "disfluency_removal_enabled": ASR_DISFLUENCY_REMOVAL_ENABLED,
        "heartbeat": ASR_HEARTBEAT,
    }
    if ASR_MODEL == "paraformer-realtime-v2" and LANGUAGE_HINTS:
        kwargs["language_hints"] = LANGUAGE_HINTS
    if vocabulary_id:
        kwargs["vocabulary_id"] = vocabulary_id
    recognition = Recognition(**kwargs)
    recognition.start()

    frames_per_chunk = int(ASR_SAMPLE_RATE * (ASR_REALTIME_STREAM_FRAME_MS / 1000.0))
    frames_per_chunk = max(1, frames_per_chunk)
    with wave.open(path, "rb") as wf:
        while True:
            data = wf.readframes(frames_per_chunk)
            if not data:
                break
            recognition.send_audio_frame(data)

    recognition.stop()
    callback.completed.wait(timeout=60)
    with callback.lock:
        errors = list(callback.errors)
    if errors:
        raise RuntimeError(f"实时流式识别失败: {errors[0]}")
    with callback.lock:
        sentences = list(callback.sentences)
    if not sentences:
        raise RuntimeError("实时流式识别返回为空")
    return {"transcripts": [{"sentences": sentences}]}


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


def extract_dashscope_error(response):
    data = to_dict(response)
    candidates = []
    if isinstance(data, dict):
        candidates.append(data)
        output = data.get("output")
        if isinstance(output, dict):
            candidates.append(output)
    for item in candidates:
        code = item.get("code") or item.get("status_code")
        message = item.get("message") or item.get("msg") or item.get("error")
        if code is None and message is None:
            continue
        if code in (0, 200, "0", "200"):
            continue
        return f"DashScope 返回错误: {code} {message}".strip()
    return ""


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
                content=sanitize_subtitle_text(text.strip()),
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
                    content=sanitize_subtitle_text(text.strip()),
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
                content=sanitize_subtitle_text(text.strip()),
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


def build_srt(response, segment_mode="post"):
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
        snippet = ""
        try:
            snippet = json.dumps(resp_dict, ensure_ascii=False)[:500]
        except Exception:  # noqa: BLE001
            snippet = str(resp_dict)[:500]
        raise RuntimeError(f"DashScope 返回结构无法解析: {snippet}")

    transcripts = result.get("transcripts")
    if isinstance(transcripts, list) and transcripts:
        result = transcripts[0]

    sentences = result.get("sentences") or result.get("sentence_list") or []
    words = result.get("words") or result.get("word_list") or []
    transcription_url = result.get("transcription_url")

    if not sentences and not words and transcription_url:
        def _fetch():
            rate_limit("dashscope", DASHSCOPE_RPS)
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

    if words and not sentences:
        sentences = [{"begin_time": None, "end_time": None, "text": "", "words": words}]

    if segment_mode == "auto":
        if sentences:
            subs = build_srt_from_sentences(sentences, 0.001)
        else:
            subs = build_srt_from_words(words, 0.001)
    else:
        post = post_process_asr_result(
            {"transcripts": [{"sentences": sentences}]},
            max_duration_seconds=ASR_MAX_DURATION_SECONDS,
            max_chars=ASR_MAX_CHARS,
            min_duration_seconds=ASR_MIN_DURATION_SECONDS,
            min_chars=ASR_MIN_CHARS,
            merge_gap_ms=ASR_MERGE_GAP_MS,
        )
        subs = [
            srt.Subtitle(
                index=item["index"],
                start=timedelta(milliseconds=item["start_ms"]),
                end=timedelta(milliseconds=item["end_ms"]),
                content=item["text"],
            )
            for item in post
        ]

    if not subs:
        raise RuntimeError("未找到带时间戳的识别结果")

    return subs, srt.compose(subs)


class MemoryTranslateCache:
    def __init__(self):
        self.cache = {}
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            return self.cache.get(key)

    def set(self, key, text):
        with self.lock:
            self.cache[key] = text


class TranslateCache:
    def __init__(self, db_path):
        self.db_path = db_path
        self.lock = threading.Lock()
        self.failed = False
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        with self.conn:
            self.conn.execute(
                "CREATE TABLE IF NOT EXISTS translations (key TEXT PRIMARY KEY, text TEXT)"
            )

    def get(self, key):
        with self.lock:
            if self.failed:
                return None
            try:
                cur = self.conn.execute(
                    "SELECT text FROM translations WHERE key = ?", (key,)
                )
                row = cur.fetchone()
                return row[0] if row else None
            except sqlite3.Error as exc:
                if not self.failed:
                    log(
                        "WARN",
                        "翻译缓存读取失败，后续将跳过缓存",
                        db=self.db_path,
                        error=str(exc),
                    )
                self.failed = True
                return None

    def set(self, key, text):
        with self.lock:
            if self.failed:
                return
            try:
                self.conn.execute(
                    "INSERT OR REPLACE INTO translations (key, text) VALUES (?, ?)",
                    (key, text),
                )
                self.conn.commit()
            except sqlite3.Error as exc:
                if not self.failed:
                    log(
                        "WARN",
                        "翻译缓存写入失败，后续将跳过缓存",
                        db=self.db_path,
                        error=str(exc),
                    )
                self.failed = True


def cache_key(src_lang, dst_lang, text):
    data = f"{src_lang}|{dst_lang}|{text}".encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def normalize_lines(text):
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        stripped = clean_line_prefix(stripped)
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
    items,
    cache,
    failed_log,
    src_lang,
    dst_lang,
    work_info=None,
    glossary=None,
    work_metadata=None,
    use_polish=False,
    llm_client=None,
):
    if llm_client is None:
        if not LLM_BASE_URL or not LLM_API_KEY:
            raise RuntimeError("缺少 LLM_BASE_URL 或 LLM_API_KEY")
        llm_client = llm_client_from_env()
    if llm_client is None:
        raise RuntimeError("缺少 LLM 客户端")

    def get_text(item):
        if isinstance(item, str):
            return item
        return item.get("cur_text", "")

    to_translate = []
    results = [None] * len(items)
    keys = []

    for i, item in enumerate(items):
        text = get_text(item)
        key = cache_key(src_lang, dst_lang, text)
        cached = cache.get(key)
        if cached is not None:
            cleaned = clean_line_prefix(cached)
            results[i] = cleaned
            cache.set(key, cleaned)
        else:
            keys.append((i, key))
            to_translate.append(item)

    if not to_translate:
        return results

    batch_size = 1 if CONTEXT_AWARE_ENABLED else BATCH_LINES
    batches = []
    for idx in range(0, len(to_translate), batch_size):
        batch = to_translate[idx : idx + batch_size]
        batch_keys = keys[idx : idx + batch_size]
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

    def build_context_block(item):
        if isinstance(item, str):
            cleaned = item.replace("<br>", "\n")
            return f"【当前行】:\n{cleaned}"
        full_text = item.get("full_text", "").replace("<br>", "\n")
        prev_text = item.get("prev_text", "").replace("<br>", "\n")
        cur_text = item.get("cur_text", "").replace("<br>", "\n")
        next_text = item.get("next_text", "").replace("<br>", "\n")
        return (
            f"【同组完整原文】:\n{full_text}\n\n"
            f"【上一行】:\n{prev_text}\n\n"
            f"【当前行】:\n{cur_text}\n\n"
            f"【下一行】:\n{next_text}"
        )

    def call_llm(batch_items):
        glossary_hint = format_glossary(glossary)
        metadata_context = format_metadata_context(work_metadata, dst_lang)
        if CONTEXT_AWARE_ENABLED:
            system_prompt = (
                "你是专业的字幕翻译人员。\n\n"
                f"- 源语言：{src_lang}\n"
                f"- 目标语言：{dst_lang}\n\n"
                "任务：将源语言字幕翻译成适合影视字幕阅读的简洁口语化译文。\n\n"
                "硬性要求：\n"
                "- 严格做到「一行输入对应一行输出」：每个条目只翻译当前行。\n"
                "- 不合并行、不拆分行、不输出多余解释或标注。\n"
                "- 不得随意删除信息，必要时可根据上下文补齐省略。\n"
                "- 保留人名、地名、技能名、组织名等专有名词。\n"
                f"\n{glossary_hint}"
            )
        else:
            system_prompt = (
                f"你是专业影视字幕译者。翻译为{dst_lang}，保持与输入行数一致。"
                "一行输入对应一行输出，不要增删行。"
                "输出时每行以编号 [n] 开头，对应输入编号。"
                "不要添加解释、不要多余标点。"
                "遇到人名或专有名词尽量保留原文或音译。译文要短、口语化、适合字幕阅读。"
                f"\n\n{glossary_hint}"
            )
        context_hint = work_hint()
        if metadata_context:
            context_hint = f"{context_hint}\n\n{metadata_context}"
        if CONTEXT_AWARE_ENABLED:
            blocks = []
            for i, item in enumerate(batch_items, start=1):
                blocks.append(f"[{i}]\n{build_context_block(item)}")
            if len(batch_items) == 1:
                user_prompt = (
                    f"背景提示：{context_hint}\n\n"
                    "下面是当前字幕行及上下文。请只翻译【当前行】，"
                    "仅输出 1 行译文，不要编号。\n"
                    + "\n\n".join(blocks)
                )
            else:
                user_prompt = (
                    f"背景提示：{context_hint}\n\n"
                    "下面是若干条字幕台词，每条前面都有编号 [n]。"
                    "请参考上下文，只翻译【当前行】，保持行号不变。"
                    "输出时每行以相同编号开头。\n"
                    + "\n\n".join(blocks)
                )
        else:
            indexed_lines = [
                f"[{i}] {get_text(item)}" for i, item in enumerate(batch_items, start=1)
            ]
            user_prompt = (
                f"背景提示：{context_hint}\n\n"
                "下面是若干条字幕台词，每条前面都有编号 [n]。"
                "请逐条翻译，保持行号不变。输出时每行以相同的编号开头，后面是译文。\n"
                + "\n".join(indexed_lines)
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
                if CONTEXT_AWARE_ENABLED and len(batch_lines) == 1:
                    raw_lines = [line for line in raw_output.splitlines() if line.strip()]
                    text = clean_line_prefix(raw_lines[0]) if raw_lines else ""
                    out_lines = [text]
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
                    cleaned = clean_line_prefix(line)
                    cache.set(key, cleaned)
                    results[idx] = cleaned
                continue

            with open(failed_log, "a", encoding="utf-8") as f:
                f.write("BATCH_FAILED\\n")
                f.write("\\n".join(get_text(item) for item in batch))
                f.write(f"\nERROR: {err}\n\n")

            for (idx, key), line in zip(batch_keys, batch):
                try:
                    translated = translate_fallback_line(line)
                    cleaned = clean_line_prefix(translated)
                    cache.set(key, cleaned)
                    results[idx] = cleaned
                except Exception as exc:  # noqa: BLE001
                    with open(failed_log, "a", encoding="utf-8") as f:
                        f.write("LINE_FAILED\\n")
                        f.write(line)
                        f.write(f"\nERROR: {exc}\n\n")
                    results[idx] = line

    if use_polish:
        original_lines = [get_text(item) for item in items]
        results = polish_subtitles(
            original_lines,
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
    work_metadata=None,
    use_polish=False,
    llm_client=None,
):
    lines = []
    for sub in subs:
        start_ms = int(sub.start.total_seconds() * 1000)
        end_ms = int(sub.end.total_seconds() * 1000)
        text_src = sanitize_subtitle_text(sub.content).replace("\n", "<br>")
        lines.append(
            SubtitleLine(
                index=sub.index,
                start_ms=start_ms,
                end_ms=end_ms,
                text_src=text_src,
            )
        )

    if GROUPING_ENABLED:
        groups = group_subtitles(lines, src_lang)
    else:
        groups = {}
        for line in lines:
            line.group_id = line.index
            groups[line.index] = SubtitleGroup(
                group_id=line.index,
                line_indices=[line.index],
                full_text_src=line.text_src,
            )

    index_map = {line.index: line for line in lines}
    group_positions = {}
    for group in groups.values():
        for pos, idx in enumerate(group.line_indices):
            group_positions[(group.group_id, idx)] = pos

    items = []
    for line in lines:
        group = groups.get(line.group_id)
        if not group:
            items.append({"cur_text": line.text_src, "full_text": line.text_src})
            continue
        idxs = group.line_indices
        pos = group_positions.get((group.group_id, line.index), 0)
        prev_text = ""
        next_text = ""
        if pos > 0:
            prev_text = index_map[idxs[pos - 1]].text_src
        if pos < len(idxs) - 1:
            next_text = index_map[idxs[pos + 1]].text_src
        items.append(
            {
                "cur_text": line.text_src,
                "prev_text": prev_text,
                "next_text": next_text,
                "full_text": group.full_text_src,
            }
        )

    translated = translate_via_llm(
        items,
        cache,
        failed_log,
        src_lang,
        dst_lang,
        work_info=work_info,
        glossary=glossary,
        work_metadata=work_metadata,
        use_polish=use_polish,
        llm_client=llm_client,
    )
    new_subs = []
    for sub, text in zip(subs, translated):
        content = text.replace("<br>", "\n").strip()
        content = wrap_lines(content, dst_lang)
        content = sanitize_subtitle_text(content)
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
        rate_limit("llm", LLM_RPS)
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


def translate_failed_path(name, dst_lang, multiple, out_dir):
    if multiple:
        return os.path.join(out_dir, f"{name}.translate_failed.{dst_lang}.log")
    return os.path.join(out_dir, f"{name}.translate_failed.log")


def should_skip(video_path, force_once=False):
    name = base_name(video_path)
    out_dir = output_dir_for(video_path)
    srt_path, done_path, lock_path, _ = output_paths(name, out_dir)
    fail_path = asr_failed_path(name, out_dir)

    if not force_once and os.path.exists(done_path):
        return True, "done_exists"
    if not force_once and os.path.exists(srt_path) and not OUTPUT_TO_SOURCE_DIR:
        return True, "srt_exists"
    if os.path.exists(lock_path):
        if is_lock_stale(lock_path):
            log("INFO", "清理过期锁", path=video_path)
            remove_lock(lock_path)
            return False, "lock_stale_removed"
        return True, "lock_exists"
    if not force_once and os.path.exists(fail_path):
        state = load_asr_fail_state(fail_path)
        count = int(state.get("count", 0) or 0)
        fatal = bool(state.get("fatal", False))
        if ASR_MAX_FAILURES > 0 and count >= ASR_MAX_FAILURES:
            return True, "asr_failed_fatal"
        if ASR_FAIL_COOLDOWN_SECONDS <= 0:
            return True, "asr_failed"
        age = time.time() - os.path.getmtime(fail_path)
        if age < ASR_FAIL_COOLDOWN_SECONDS:
            return True, "asr_failed_recent"
        try:
            os.remove(fail_path)
        except OSError:
            pass
    return False, ""


def process_video(video_path):
    name = base_name(video_path)
    out_dir = output_dir_for(video_path)
    srt_path, done_path, lock_path, raw_path = output_paths(name, out_dir)
    bi_path = os.path.join(out_dir, f"{name}.bi.srt")
    simplified_plain_path = os.path.join(out_dir, f"{name}.{SIMPLIFIED_LANG}.srt")
    simplified_llm_path = os.path.join(out_dir, f"{name}.llm.{SIMPLIFIED_LANG}.srt")
    overrides = load_job_overrides(video_path)
    override_path = job_override_path(video_path)
    asr_mode = (overrides.get("asr_mode") or ASR_MODE).strip().lower()
    asr_mode = resolve_asr_mode(asr_mode, ASR_MODEL)
    segment_mode = (overrides.get("segment_mode") or SEGMENT_MODE).strip().lower()
    ignore_simplified_subtitle = override_bool(
        overrides.get("ignore_simplified_subtitle"), IGNORE_SIMPLIFIED_SUBTITLE
    )
    use_existing_subtitle = override_bool(
        overrides.get("use_existing_subtitle"), USE_EXISTING_SUBTITLE
    )
    force_once = override_bool(overrides.get("force_once"), False)
    force_asr = override_bool(overrides.get("force_asr"), False)
    force_translate = override_bool(overrides.get("force_translate"), False)
    if force_asr:
        use_existing_subtitle = False
    eval_enabled = should_collect_eval(video_path)
    eval_reference_text = ""
    eval_skip_main_srt = False

    if not is_stable_file(video_path):
        log("SKIP", "文件未下载完成", path=video_path)
        return

    skip, reason = should_skip(video_path, force_once=force_once)
    if skip:
        log("SKIP", "已处理或正在处理", path=video_path, reason=reason)
        return

    if not create_lock(lock_path):
        log("SKIP", "锁已存在", path=video_path)
        return

    tmp_wav = os.path.join(TMP_DIR, f"{name}-{uuid.uuid4().hex}.wav")
    tmp_srt = None
    object_key = None
    bucket = None
    vocab_id = None
    run_started_at = int(time.time())
    run_id = f"{run_started_at}-{uuid.uuid4().hex[:6]}"
    run_log_path, run_meta_path = _run_log_paths(video_path, out_dir, run_id)

    stage = "init"
    try:
        RUN_LOG_CONTEXT.path = run_log_path
        _write_run_meta(
            run_meta_path,
            {
                "run_id": run_id,
                "path": video_path,
                "status": "running",
                "stage": stage,
                "started_at": run_started_at,
                "log_path": run_log_path,
            },
        )
        if is_realtime_model(ASR_MODEL) and asr_mode == "offline":
            log("WARN", "ASR 模型为实时但模式为离线", path=video_path, model=ASR_MODEL)
        if not is_realtime_model(ASR_MODEL) and asr_mode == "realtime":
            log("WARN", "ASR 模型为离线但模式为实时", path=video_path, model=ASR_MODEL)
        log(
            "INFO",
            "开始处理",
            path=video_path,
            asr_mode=asr_mode,
            segment_mode=segment_mode,
            run_id=run_id,
        )
        stage = "probe"

        media_info = probe_media(video_path)
        audio_cfg = AudioSelectionConfig(
            prefer_langs=AUDIO_PREFER_LANGS,
            exclude_title_keywords=AUDIO_EXCLUDE_TITLES,
            user_specified_index=_parse_int(AUDIO_INDEX),
            user_specified_lang=AUDIO_LANG or None,
        )
        audio_track = select_audio_track(media_info.audio_tracks, audio_cfg)
        if audio_track:
            log(
                "INFO",
                "选择音轨",
                path=video_path,
                audio_index=audio_track.index,
                audio_lang=audio_track.language,
                audio_title=audio_track.title,
            )
        else:
            log("WARN", "未找到音轨", path=video_path)

        subtitle_cfg = SubtitleSelectionConfig(
            mode=SUBTITLE_MODE,
            prefer_langs_src=SUBTITLE_PREFER_LANGS_SRC,
            prefer_langs_dst=SUBTITLE_PREFER_LANGS_DST,
            exclude_title_keywords=SUBTITLE_EXCLUDE_TITLES,
            user_specified_index=_parse_int(SUBTITLE_INDEX),
            user_specified_lang=SUBTITLE_LANG or None,
        )
        subtitle_candidates = list(media_info.subtitle_tracks)
        for ext in list_external_subtitles(video_path):
            subtitle_candidates.append(
                SubtitleTrackInfo(
                    index=-1,
                    language=ext.get("language"),
                    title=ext.get("name"),
                    codec=os.path.splitext(ext.get("name") or "")[1].lstrip("."),
                    is_default=False,
                    is_forced=False,
                    is_image_based=False,
                    kind="external",
                    path=ext.get("path"),
                )
            )
        selected_subtitle = select_subtitle_track(
            subtitle_candidates,
            subtitle_cfg,
            audio_track.language if audio_track else None,
        )
        if selected_subtitle and subtitle_cfg.mode == "reuse_if_good" and selected_subtitle.is_image_based:
            log(
                "WARN",
                "字幕轨为图像型，忽略复用",
                path=video_path,
                subtitle_index=selected_subtitle.index,
                subtitle_codec=selected_subtitle.codec,
            )
            selected_subtitle = None
        if selected_subtitle:
            log(
                "INFO",
                "选择字幕轨",
                path=video_path,
                subtitle_index=selected_subtitle.index,
                subtitle_lang=selected_subtitle.language,
                subtitle_title=selected_subtitle.title,
                subtitle_codec=selected_subtitle.codec,
                subtitle_kind=selected_subtitle.kind,
                subtitle_mode=subtitle_cfg.mode,
            )

        simplified_subs = []
        traditional_subs = []
        other_subs = []
        stage = "subtitle_select"
        if subtitle_cfg.mode != "ignore":
            if selected_subtitle:
                info = {
                    "kind": selected_subtitle.kind,
                    "language": selected_subtitle.language,
                    "title": selected_subtitle.title,
                    "codec": selected_subtitle.codec,
                    "is_default": selected_subtitle.is_default,
                    "is_forced": selected_subtitle.is_forced,
                    "is_image_based": selected_subtitle.is_image_based,
                }
                if selected_subtitle.kind == "external":
                    info["path"] = selected_subtitle.path
                    info["name"] = selected_subtitle.title
                else:
                    info["stream_index"] = selected_subtitle.index
                variant = describe_subtitle_variant(info, video_path=video_path)
                info["variant"] = variant
                if variant == "simplified":
                    simplified_subs = [info]
                elif variant == "traditional":
                    traditional_subs = [info]
                else:
                    other_subs = [info]
            else:
                simplified_subs, traditional_subs, other_subs = inspect_existing_subtitles(video_path)
        if subtitle_cfg.mode == "reference":
            simplified_subs = []
            traditional_subs = []
            other_subs = []

        if simplified_subs or traditional_subs or other_subs:
            log(
                "INFO",
                "发现现有字幕",
                path=video_path,
                simplified_count=len(simplified_subs),
                traditional_count=len(traditional_subs),
                other_count=len(other_subs),
                use_existing_subtitle=use_existing_subtitle,
                simplified_lang=SIMPLIFIED_LANG,
                ignore_simplified_subtitle=ignore_simplified_subtitle,
                subtitle_mode=subtitle_cfg.mode,
            )
        if not ignore_simplified_subtitle and (
            simplified_subs or os.path.exists(simplified_plain_path) or os.path.exists(simplified_llm_path)
        ):
            if not eval_enabled:
                log("SKIP", "检测到简体中文字幕，跳过识别与翻译", path=video_path)
                try:
                    if simplified_subs:
                        subs, srt_text, tmp_srt = load_subtitles_from_source(
                            video_path, simplified_subs[0]
                        )
                        with open(srt_path, "w", encoding="utf-8") as f:
                            f.write(srt_text)
                        if srt_path != simplified_plain_path:
                            with open(simplified_plain_path, "w", encoding="utf-8") as f:
                                f.write(srt_text)
                        log(
                            "INFO",
                            "已保存简体字幕",
                            path=video_path,
                            output=srt_path,
                            simplified_output=simplified_plain_path,
                        )
                except Exception as exc:  # noqa: BLE001
                    log("ERROR", "提取简体字幕失败", path=video_path, error=str(exc))
                with open(done_path, "w", encoding="utf-8") as f:
                    f.write("done")
                return
            log("INFO", "检测到简体字幕，启用评估采集", path=video_path)
            eval_skip_main_srt = True
            try:
                if simplified_subs:
                    ref_subs, ref_text, tmp_srt = load_subtitles_from_source(
                        video_path, simplified_subs[0]
                    )
                    eval_reference_text = ref_text
                elif os.path.exists(simplified_plain_path):
                    eval_reference_text = read_text_file(simplified_plain_path)
            except Exception as exc:  # noqa: BLE001
                log("ERROR", "读取评估参考字幕失败", path=video_path, error=str(exc))

        subs = None
        srt_text = None
        work_glossary = {}
        hotwords = []
        vocab_id = None
        if traditional_subs:
            other_subs = traditional_subs + other_subs
        if other_subs and use_existing_subtitle:
            log("INFO", "发现外部/内封字幕，尝试直接使用字幕生成简体", path=video_path)
            try:
                subs, srt_text, tmp_srt = load_subtitles_from_source(video_path, other_subs[0])
                if SUBTITLE_REUSE_MIN_CONFIDENCE > 0:
                    sample_text = (srt_text or "")[:SUBTITLE_REUSE_SAMPLE_CHARS]
                    lang_hints = [
                        other_subs[0].get("language") if other_subs else "",
                        audio_track.language if audio_track else "",
                        SRC_LANG if SRC_LANG != "auto" else "",
                    ]
                    reuse_confidence = _select_reuse_confidence(sample_text, lang_hints)
                    if reuse_confidence < SUBTITLE_REUSE_MIN_CONFIDENCE:
                        log(
                            "WARN",
                            "字幕语言置信度不足，回退到语音识别",
                            path=video_path,
                            confidence=round(reuse_confidence, 3),
                            threshold=SUBTITLE_REUSE_MIN_CONFIDENCE,
                        )
                        subs = None
                        srt_text = None
                if subs and srt_text:
                    with open(srt_path, "w", encoding="utf-8") as f:
                        f.write(srt_text)
                    log("INFO", "已保存现有字幕", path=video_path, output=srt_path)
            except Exception as exc:  # noqa: BLE001
                log("ERROR", "读取现有字幕失败，回退到语音识别", path=video_path, error=str(exc))
                subs = None
                srt_text = None

        stage = "asr_prepare"
        if subs is None:
            if other_subs and not use_existing_subtitle:
                log("INFO", "忽略现有字幕，继续语音识别", path=video_path)
            if not force_asr and not other_subs and os.path.exists(srt_path):
                try:
                    existing_text = read_text_file(srt_path)
                    subs = list(srt.parse(existing_text))
                    srt_text = srt.compose(subs)
                    log("INFO", "使用已生成字幕进行简体生成", path=video_path, input=srt_path)
                except Exception as exc:  # noqa: BLE001
                    log("ERROR", "读取已生成字幕失败，回退到语音识别", path=video_path, error=str(exc))
                    subs = None
                    srt_text = None
            elif force_asr and os.path.exists(srt_path):
                log("INFO", "强制 ASR，忽略已生成字幕", path=video_path, input=srt_path)
            if subs is None:
                path_info = guess_work_info_from_path(video_path)
                alias_map = load_title_aliases(TITLE_ALIASES_PATH)
                title_aliases = resolve_title_aliases(path_info.title, alias_map)
                work_glossary = load_work_glossary_by_titles([path_info.title] + title_aliases)
                asr_lang = _normalize_lang_for_asr(audio_track.language if audio_track else SRC_LANG)
                hotwords = build_asr_hotwords(None, work_glossary, title_aliases, asr_lang)
                if hotwords:
                    log("INFO", "ASR 热词启用", path=video_path, count=len(hotwords))
                    if ASR_HOTWORDS_MODE == "vocabulary":
                        vocab_id = create_vocabulary_id(hotwords, asr_lang)
                        if vocab_id:
                            log("INFO", "热词词表创建", path=video_path, vocab_id=vocab_id)
                ffmpeg_extract_wav(
                    video_path,
                    tmp_wav,
                    audio_track.index if audio_track else None,
                    sample_rate=ASR_SAMPLE_RATE,
                )

        stage = "asr_call"
        if subs is None:
            if asr_mode == "realtime":
                if hotwords and ASR_HOTWORDS_MODE == "param":
                    log("WARN", "实时 ASR 不支持 param 热词，已忽略", path=video_path)
                merged_subs, responses, failures, total, chunk_seconds = run_realtime_chunks(
                    video_path, tmp_wav, vocab_id, segment_mode=segment_mode
                )
                if (
                    ASR_REALTIME_ADAPTIVE_RETRY
                    and total
                    and failures / total >= ASR_REALTIME_FAILURE_RATE_THRESHOLD
                    and chunk_seconds > ASR_REALTIME_CHUNK_MIN_SECONDS
                ):
                    log(
                        "WARN",
                        "实时 ASR 失败率过高，尝试缩短分片",
                        path=video_path,
                        failures=failures,
                        total=total,
                        chunk_seconds=chunk_seconds,
                    )
                    fallback_seconds = max(
                        ASR_REALTIME_CHUNK_MIN_SECONDS,
                        max(1, chunk_seconds // 2),
                    )
                    fallback_seconds = min(
                        fallback_seconds, ASR_REALTIME_CHUNK_MAX_SECONDS
                    )
                    orig_seconds = ASR_REALTIME_CHUNK_SECONDS
                    try:
                        globals()["ASR_REALTIME_CHUNK_SECONDS"] = fallback_seconds
                        merged_subs, responses, failures, total, _ = run_realtime_chunks(
                            video_path, tmp_wav, vocab_id, segment_mode=segment_mode
                        )
                    finally:
                        globals()["ASR_REALTIME_CHUNK_SECONDS"] = orig_seconds
                if (
                    ASR_REALTIME_FALLBACK_ENABLED
                    and total
                    and failures / total >= ASR_REALTIME_FAILURE_RATE_THRESHOLD
                ):
                    log(
                        "WARN",
                        "实时 ASR 失败率仍偏高，切换为 VAD 断句重试",
                        path=video_path,
                        failures=failures,
                        total=total,
                    )
                    merged_subs, responses, failures, total, _ = run_realtime_chunks(
                        video_path,
                        tmp_wav,
                        vocab_id,
                        segment_mode=segment_mode,
                        semantic_punctuation_enabled=False,
                        max_sentence_silence=ASR_REALTIME_FALLBACK_MAX_SENTENCE_SILENCE,
                        multi_threshold_mode_enabled=ASR_REALTIME_FALLBACK_MULTI_THRESHOLD,
                    )
                if SAVE_RAW_JSON:
                    with open(raw_path, "w", encoding="utf-8") as f:
                        json.dump(responses, f, ensure_ascii=False, indent=2)
                if not merged_subs:
                    raise RuntimeError("实时 ASR 无有效分片结果")
                subs = merged_subs
                srt_text = srt.compose(subs)
            else:
                object_key = f"{OSS_PREFIX}{os.path.basename(tmp_wav)}"
                bucket = oss_client()
                upload_to_oss(bucket, tmp_wav, object_key)
                url = oss_url(bucket, object_key)

                response = dashscope_transcribe(
                    url,
                    hotwords=hotwords if hotwords else None,
                    vocabulary_id=vocab_id,
                )
                if SAVE_RAW_JSON:
                    with open(raw_path, "w", encoding="utf-8") as f:
                        json.dump(to_dict(response), f, ensure_ascii=False, indent=2)

                subs, srt_text = build_srt(response, segment_mode=segment_mode)

            if subs is None or srt_text is None:
                raise RuntimeError("ASR 结果为空")
            if SRT_VALIDATE:
                fixed, issues = validate_and_fix_subs(subs)
                if issues and SRT_AUTO_FIX:
                    subs = fixed
                    srt_text = srt.compose(subs)
                    log("WARN", "SRT 修复完成", path=video_path, issues=len(issues))
            if eval_skip_main_srt:
                log("INFO", "评估模式：跳过覆盖主 SRT", path=video_path, output=srt_path)
            else:
                with open(srt_path, "w", encoding="utf-8") as f:
                    f.write(srt_text)
                log("INFO", "识别完成并保存字幕", path=video_path, output=srt_path)

        stage = "translate"
        translate_enabled = TRANSLATE or force_translate
        if translate_enabled:
            try:
                try:
                    cache = TranslateCache(CACHE_DB)
                except sqlite3.Error as exc:
                    log(
                        "WARN",
                        "翻译缓存不可用，降级为内存缓存",
                        path=video_path,
                        error=str(exc),
                    )
                    cache = MemoryTranslateCache()
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
                nfo_info, nfo_path = load_nfo_info(video_path)
                if nfo_info:
                    log(
                        "INFO",
                        "NFO 命中",
                        path=video_path,
                        nfo=nfo_path,
                        nfo_type=nfo_info.get("type"),
                        nfo_title=nfo_info.get("title"),
                    )
                    title = work_info.title or nfo_info.get("title")
                    season = work_info.season or (
                        str(nfo_info.get("season")) if nfo_info.get("season") is not None else None
                    )
                    episode = work_info.episode or (
                        str(nfo_info.get("episode")) if nfo_info.get("episode") is not None else None
                    )
                    if title != work_info.title or season != work_info.season or episode != work_info.episode:
                        work_info = WorkInfo(
                            title=title,
                            season=season,
                            episode=episode,
                            confidence=max(work_info.confidence, 0.6),
                            source=f"{work_info.source}+nfo",
                        )
                raw_glossary = load_glossary_from_yaml(GLOSSARY_PATH)
                glossary = build_effective_glossary(
                    raw_glossary,
                    work_info,
                    confidence_threshold=GLOSSARY_CONFIDENCE_THRESHOLD,
                )
                metadata = None
                metadata_config = None
                if METADATA_ENABLED:
                    metadata_config = _build_metadata_config()
                    alias_map = load_title_aliases(TITLE_ALIASES_PATH)
                    title_aliases = resolve_title_aliases(work_info.title if work_info else "", alias_map)
                    if LLM_TITLE_ALIAS_ENABLED:
                        llm_aliases = refine_work_aliases_via_llm(
                            work_info or WorkInfo(None, None, None, 0.0, "none"),
                            sample_lines,
                            llm_client=llm_client,
                            path=video_path,
                        )
                        title_aliases.extend(llm_aliases)
                    if nfo_info:
                        for key in ("title", "original_title", "episode_title"):
                            value = nfo_info.get(key)
                            if value:
                                title_aliases.append(value)
                    title_aliases = list(dict.fromkeys([item for item in title_aliases if item]))
                    snippets = {}
                    snippet_lang = SRC_LANG or "und"
                    snippets[snippet_lang] = sample_lines[:50]
                    query = _build_work_query(
                        video_path,
                        work_info,
                        subtitle_snippets=snippets,
                        language_priority=metadata_config.language_priority,
                        title_aliases=title_aliases,
                        nfo_info=nfo_info,
                        nfo_path=nfo_path,
                    )
                    metadata_service = MetadataService(metadata_config)
                    metadata = metadata_service.resolve_work(query)
                manual_metadata = load_manual_metadata(video_path, out_dir)
                if manual_metadata:
                    metadata = manual_metadata
                    log("INFO", "命中人工元数据", path=video_path)
                if metadata and metadata_config and metadata_config.debug:
                    meta_path = os.path.join(out_dir, f"{name}.metadata.json")
                    with open(meta_path, "w", encoding="utf-8") as f:
                        json.dump(
                            {
                                "query": query.__dict__,
                                "metadata": metadata.__dict__,
                            },
                            f,
                            ensure_ascii=False,
                            indent=2,
                        )
                if not work_glossary:
                    work_glossary = load_work_glossary(metadata)
                allow_translate = True
                if not force_translate:
                    duration = get_media_duration(video_path)
                    if duration is not None and duration < MIN_TRANSLATE_DURATION:
                        allow_translate = False
                        log(
                            "SKIP",
                            "视频时长过短，跳过翻译",
                            path=video_path,
                            duration=round(duration, 2),
                            min_duration=MIN_TRANSLATE_DURATION,
                        )
                else:
                    log("INFO", "强制翻译", path=video_path)
                dst_langs = parse_langs()
                if SIMPLIFIED_LANG not in dst_langs:
                    dst_langs = [SIMPLIFIED_LANG] + dst_langs
                if not dst_langs:
                    raise RuntimeError("DST_LANG 或 DST_LANGS 为空")
                bi_lang = BILINGUAL_LANG or dst_langs[0]
                multiple = len(dst_langs) > 1

                if allow_translate and subs:
                    log(
                        "INFO",
                        "开始翻译",
                        path=video_path,
                        dst_langs=dst_langs,
                        bilingual=BILINGUAL,
                    )
                    for dst_lang in dst_langs:
                        if dst_lang == SIMPLIFIED_LANG:
                            trans_path = simplified_llm_path
                        else:
                            trans_path = os.path.join(out_dir, f"{name}.{dst_lang}.srt")
                        failed_log = translate_failed_path(name, dst_lang, multiple, out_dir)
                        merged_glossary = dict(glossary)
                        if metadata:
                            merged_glossary.update(build_metadata_glossary(metadata, dst_lang))
                        if work_glossary:
                            merged_glossary.update(work_glossary)
                        try:
                            trans_subs = build_translated_subs(
                                subs,
                                cache,
                                failed_log,
                                SRC_LANG,
                                dst_lang,
                                work_info=work_info,
                                glossary=merged_glossary,
                                work_metadata=metadata,
                                use_polish=USE_POLISH,
                                llm_client=llm_client,
                            )
                            if SRT_VALIDATE:
                                fixed, issues = validate_and_fix_subs(trans_subs)
                                if issues and SRT_AUTO_FIX:
                                    trans_subs = fixed
                                    log(
                                        "WARN",
                                        "翻译 SRT 修复完成",
                                        path=video_path,
                                        lang=dst_lang,
                                        issues=len(issues),
                                    )
                            trans_text = srt.compose(trans_subs)
                            with open(trans_path, "w", encoding="utf-8") as f:
                                f.write(trans_text)
                            if BILINGUAL and dst_lang == bi_lang:
                                bi_subs = build_bilingual_subs(subs, trans_subs)
                                bi_text = srt.compose(bi_subs)
                                with open(bi_path, "w", encoding="utf-8") as f:
                                    f.write(bi_text)
                            if (
                                eval_enabled
                                and dst_lang == SIMPLIFIED_LANG
                                and eval_reference_text
                            ):
                                save_eval_sample(
                                    name,
                                    out_dir,
                                    eval_reference_text,
                                    srt_text,
                                    trans_text,
                                    {
                                        "path": video_path,
                                        "asr_mode": asr_mode,
                                        "segment_mode": segment_mode,
                                        "dst_lang": dst_lang,
                                        "timestamp": int(time.time()),
                                    },
                                )
                            log("INFO", "翻译完成", path=video_path, lang=dst_lang, output=trans_path)
                        except Exception as exc:  # noqa: BLE001
                            with open(failed_log, "a", encoding="utf-8") as f:
                                f.write(f"TRANSLATE_FAILED: {exc}\n")
                            log("ERROR", "翻译失败", path=video_path, lang=dst_lang, error=str(exc))
                elif allow_translate and not subs:
                    log("ERROR", "翻译跳过：未获取到字幕内容", path=video_path)
            except Exception as exc:  # noqa: BLE001
                failed_log = translate_failed_path(name, DST_LANG or "unknown", True, out_dir)
                with open(failed_log, "a", encoding="utf-8") as f:
                    f.write(f"TRANSLATE_FAILED: {exc}\n")
                log("ERROR", "翻译初始化失败", path=video_path, error=str(exc))

        if MOVE_DONE:
            target = os.path.join(DONE_DIR, os.path.basename(video_path))
            shutil.move(video_path, target)

        fail_path = asr_failed_path(name, out_dir)
        if os.path.exists(fail_path):
            try:
                os.remove(fail_path)
            except OSError:
                pass

        with open(done_path, "w", encoding="utf-8") as f:
            f.write("done")
        log("DONE", "处理完成", path=video_path, srt=srt_path)
        _write_run_meta(
            run_meta_path,
            {
                "run_id": run_id,
                "path": video_path,
                "status": "done",
                "stage": stage,
                "started_at": run_started_at,
                "finished_at": int(time.time()),
                "log_path": run_log_path,
            },
        )
        if DELETE_SOURCE_AFTER_DONE and not MOVE_DONE:
            try:
                os.remove(video_path)
                log("INFO", "已删除源视频", path=video_path)
            except OSError as exc:
                log("WARN", "删除源视频失败", path=video_path, error=str(exc))
    except Exception as exc:  # noqa: BLE001
        log("ERROR", "处理失败", path=video_path, error=str(exc), stage=stage)
        if stage.startswith("asr_"):
            fail_path = asr_failed_path(name, out_dir)
            state = load_asr_fail_state(fail_path)
            count = int(state.get("count", 0) or 0) + 1
            fatal = ASR_MAX_FAILURES > 0 and count >= ASR_MAX_FAILURES
            payload = {
                "ts": int(time.time()),
                "stage": stage,
                "error": str(exc),
                "count": count,
                "fatal": fatal,
            }
            save_asr_fail_state(fail_path, payload)
            if fatal:
                log(
                    "ERROR",
                    "ASR 连续失败已达上限，暂停自动重试",
                    path=video_path,
                    count=count,
                    limit=ASR_MAX_FAILURES,
                )
            else:
                log(
                    "WARN",
                    "ASR 失败进入冷却",
                    path=video_path,
                    count=count,
                    cooldown=ASR_FAIL_COOLDOWN_SECONDS,
                )
            if ASR_FAIL_ALERT:
                log("ERROR", "ASR 失败强提示", path=video_path, error=str(exc))
        _write_run_meta(
            run_meta_path,
            {
                "run_id": run_id,
                "path": video_path,
                "status": "failed",
                "stage": stage,
                "error": str(exc),
                "started_at": run_started_at,
                "finished_at": int(time.time()),
                "log_path": run_log_path,
            },
        )
    finally:
        if getattr(RUN_LOG_CONTEXT, "path", "") == run_log_path:
            RUN_LOG_CONTEXT.path = ""
        remove_lock(lock_path)
        try:
            if os.path.exists(tmp_wav):
                os.remove(tmp_wav)
        except OSError:
            pass
        try:
            if tmp_srt and os.path.exists(tmp_srt):
                os.remove(tmp_srt)
        except OSError:
            pass
        if DELETE_OSS_OBJECT and bucket and object_key:
            try:
                delete_oss_object(bucket, object_key)
            except Exception as exc:  # noqa: BLE001
                log("ERROR", "删除 OSS 对象失败", path=video_path, error=str(exc))
        if vocab_id:
            delete_vocabulary_id(vocab_id)
        if force_once:
            try:
                if os.path.exists(override_path):
                    os.remove(override_path)
                    log("INFO", "已清理强制运行配置", path=video_path)
            except OSError as exc:
                log("WARN", "清理强制运行配置失败", path=video_path, error=str(exc))


def scan_once(q=None, pending=None, lock=None, reason="interval", **kwargs):
    if q is None and "queue" in kwargs:
        q = kwargs["queue"]
    found = 0
    for root in WATCH_DIR_LIST:
        try:
            if WATCH_RECURSIVE:
                walker = os.walk(root)
                for base, _dirs, files in walker:
                    for name in files:
                        path = os.path.join(base, name)
                        if not is_video_file(path):
                            continue
                        enqueue(path, q, pending, lock)
                        found += 1
            else:
                entries = os.listdir(root)
                for name in entries:
                    path = os.path.join(root, name)
                    if not os.path.isfile(path):
                        continue
                    if not is_video_file(path):
                        continue
                    enqueue(path, q, pending, lock)
                    found += 1
        except FileNotFoundError:
            continue
    if reason != "interval" and found == 0:
        log("WARN", "扫描未发现媒体", reason=reason, watch=WATCH_DIR_LIST)
    return found


def scan_loop(q, pending, lock):
    while True:
        if _check_trigger_files():
            scan_once(q, pending, lock, reason="trigger")
            continue
        scan_once(q, pending, lock, reason="interval")
        time.sleep(SCAN_INTERVAL)


def enqueue(path, q, pending, lock):
    with lock:
        if path in pending:
            return
        pending.add(path)
        priority = _compute_queue_priority(path)
        _queue_put(q, path, priority)


def _queue_put(q, path, priority):
    if q is None:
        return
    if isinstance(q, queue.PriorityQueue):
        q.put((priority, time.time(), path))
    else:
        q.put(path)


def _queue_extract_path(item):
    if isinstance(item, tuple) and len(item) >= 3:
        return item[2]
    return item


def _compute_queue_priority(path):
    if not QUEUE_PRIORITY_ENABLED:
        return QUEUE_PRIORITY_DEFAULT
    out_dir = output_dir_for(path)
    base = base_name(path)
    if out_dir and _has_translate_failed(out_dir, base):
        return QUEUE_PRIORITY_FAILED
    if out_dir and not _has_simplified_subtitle(out_dir, base):
        return QUEUE_PRIORITY_MISSING_ZH
    return QUEUE_PRIORITY_DEFAULT


def _has_translate_failed(out_dir, base):
    try:
        for name in os.listdir(out_dir):
            if name.startswith(f"{base}.translate_failed"):
                return True
    except OSError:
        return False
    return False


def _has_simplified_subtitle(out_dir, base):
    if not SIMPLIFIED_LANG:
        return True
    candidates = [
        os.path.join(out_dir, f"{base}.{SIMPLIFIED_LANG}.srt"),
        os.path.join(out_dir, f"{base}.llm.{SIMPLIFIED_LANG}.srt"),
    ]
    return any(os.path.exists(path) for path in candidates)


def worker_loop(q, pending, lock):
    while True:
        item = q.get()
        path = _queue_extract_path(item)
        try:
            with _semaphore_guard(JOB_SEMAPHORE):
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
        "-r" if WATCH_RECURSIVE else "",
        "--format",
        "%w%f",
        *WATCH_DIR_LIST,
    ]
    cmd = [item for item in cmd if item]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    for line in proc.stdout:
        path = line.strip()
        if not path:
            continue
        if TRIGGER_SCAN_FILE and os.path.basename(path) == TRIGGER_SCAN_FILE:
            try:
                os.remove(path)
            except OSError:
                pass
            log("INFO", "触发文件扫描", path=path)
            scan_once(q, pending, lock, reason="trigger")
            continue
        if os.path.isfile(path) and is_video_file(path):
            enqueue(path, q, pending, lock)


def _check_trigger_files():
    if not TRIGGER_SCAN_FILE:
        return False
    for base in WATCH_DIR_LIST:
        path = os.path.join(base, TRIGGER_SCAN_FILE)
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass
            log("INFO", "触发文件扫描", path=path)
            return True
    return False


def handle_scan_signal(signum, frame):
    log("INFO", "收到扫描信号，开始立即扫描", signal=signum)
    if GLOBAL_QUEUE is None or GLOBAL_PENDING is None or GLOBAL_LOCK is None:
        log("WARN", "扫描信号未就绪，跳过", signal=signum)
        return
    scan_once(GLOBAL_QUEUE, GLOBAL_PENDING, GLOBAL_LOCK, reason="signal")


if __name__ == "__main__":
    ensure_dirs()

    if not WATCH_DIR_LIST:
        log("ERROR", "WATCH_DIRS 为空，请配置监听目录")
        raise SystemExit(1)
    if not DASHSCOPE_API_KEY:
        log("ERROR", "缺少 DASHSCOPE_API_KEY")
    if ASR_MODE == "offline":
        if not (OSS_ENDPOINT and OSS_BUCKET and OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET):
            log("ERROR", "缺少 OSS 配置")

    q = queue.PriorityQueue() if QUEUE_PRIORITY_ENABLED else queue.Queue()
    pending = set()
    lock = threading.Lock()
    GLOBAL_QUEUE = q
    GLOBAL_PENDING = pending
    GLOBAL_LOCK = lock

    for _ in range(WORKER_CONCURRENCY):
        threading.Thread(target=worker_loop, args=(q, pending, lock), daemon=True).start()
    threading.Thread(target=scan_loop, args=(q, pending, lock), daemon=True).start()
    signal.signal(signal.SIGHUP, handle_scan_signal)
    signal.signal(signal.SIGUSR1, handle_scan_signal)

    log(
        "INFO",
        "开始监听",
        watch=WATCH_DIR_LIST,
        out=OUT_DIR,
        recursive=WATCH_RECURSIVE,
        output_to_source_dir=OUTPUT_TO_SOURCE_DIR,
        worker_concurrency=WORKER_CONCURRENCY,
        max_active_jobs=MAX_ACTIVE_JOBS,
        ffmpeg_concurrency=FFMPEG_CONCURRENCY,
        asr_mode=ASR_MODE,
        segment_mode=SEGMENT_MODE,
        queue_priority_enabled=QUEUE_PRIORITY_ENABLED,
        queue_priority_failed=QUEUE_PRIORITY_FAILED,
        queue_priority_missing_zh=QUEUE_PRIORITY_MISSING_ZH,
        queue_priority_default=QUEUE_PRIORITY_DEFAULT,
    )
    inotify_loop(q, pending, lock)
ASR_FAIL_COOLDOWN_SECONDS = int(os.getenv("ASR_FAIL_COOLDOWN_SECONDS", "3600") or "0")
