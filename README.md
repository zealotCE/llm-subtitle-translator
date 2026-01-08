# llm-subtitle-translator

## 功能概览
- 监听 `watch/` 目录：新文件写入完成或移动入目录后自动处理
- 定时扫描兜底：容器重启后仍能补处理旧文件
- 视频抽取音频 → 上传 OSS → 百炼 Paraformer 异步识别 → 智能二次切片 → 行分组 + 带上下文逐行翻译 → 生成 SRT
- 跳过已处理文件（`.srt`/`.done`/`.lock`）并清理过期锁
- 若检测到内封/外置字幕但非简体，则生成简体中文字幕；检测到简体则跳过识别与翻译

## 目录结构
- `watch/`：待处理视频
- `output/`：输出字幕与标记文件
- `logs/`：运行日志（默认输出到 `worker.log`，可配置 `LOG_DIR`）
- `watcher/`：处理服务代码
- `docs/FAQ.md`：常见问题

## 快速开始
1. 复制配置文件：
   ```bash
   cp .env.example .env
   ```
2. 填写 `.env`（至少设置 `WATCH_DIRS`）以及 DashScope 与 OSS 配置（不要提交密钥）
3. 启动服务：
   ```bash
   docker compose up -d --build
   ```
4. 把视频放入 `watch/`，字幕会输出到 `output/`

### 使用 GHCR 镜像

本项目已配置 GitHub Actions 自动构建 GHCR 镜像：`ghcr.io/<owner>/<repo>`。

- `latest`：主分支构建
- `vX.Y.Z`：发布 tag 构建
- `sha-<commit>`：提交快照

示例（替换为你的仓库地址）：

```bash
# 拉取
docker pull ghcr.io/<owner>/<repo>:latest

# 运行（示例）
docker run -d \
  --name autosub \
  --env-file .env \
  -v $(pwd)/watch:/watch \
  -v $(pwd)/output:/output \
  ghcr.io/<owner>/<repo>:latest
```

也可以直接用 `docker-compose.yml`（默认已指向 GHCR 镜像）：

```bash
# 拉取并启动
docker compose pull
docker compose up -d
```

### Web UI（推荐）
新 UI 位于 `web/`，提供媒体库、活动、设置、字幕预览/编辑与强制运行选项。

- **强制运行**：检测到内嵌/外挂字幕时弹出确认，可选择“跳过简体检测/强制翻译/强制 ASR/优先复用”
- **配置版本**：设置页支持保存/应用版本与导入导出 JSON

Docker 运行（示例）：

```bash
docker compose up -d web
```

Web 读取根目录 `.env`，并会访问 `WATCH_DIRS/OUT_DIR/LOG_DIR` 指向的目录，请确保 compose 中已挂载对应卷。
如启用 `WEB_AUTH_ENABLED=true`，先访问 `http://localhost:3000/login` 登录。

### Legacy Web 设置页（可选）
包含设置页与简单的上传/任务列表页面，保存后需手动重启服务才会生效。

```bash
docker run --rm -p 8000:8000 \
  -v $(pwd)/.env:/app/.env \
  -v $(pwd)/.env.example:/app/.env.example \
  ghcr.io/zealotce/llm-subtitle-translator:latest \
  python /app/web.py
```

访问地址：
- 设置页：`http://localhost:8000/`
- 上传页：`http://localhost:8000/upload`
- 任务页：`http://localhost:8000/jobs`
- 日志页：`http://localhost:8000/logs`
- 字幕编辑：在任务页点击“查看”
- 媒体库：`http://localhost:8000/media`
- 元数据：在媒体库点击“元数据”
- 导出：`/export/jobs`、`/export/logs`、`/export/media`

环境变量：
- `WEB_HOST`：默认 `0.0.0.0`
- `WEB_PORT`：默认 `8000`
- `WEB_CONFIG_PATH`：默认 `/app/.env`
- `WEB_SCHEMA_PATH`：默认 `/app/.env.example`
- `WEB_DB_PATH`：任务数据库路径（默认 `web.db`，容器内建议 `/app/web.db`）
- `WEB_PROJECT_ROOT`：Web UI 解析相对路径的根目录（默认父目录）
- `WEB_UPLOAD_DIR`：上传保存目录（为空则取 `WATCH_DIRS` 第一个）
- `WEB_UPLOAD_OVERWRITE`：是否允许覆盖同名文件（默认 `false`）
- `WEB_MAX_UPLOAD_MB`：上传大小上限（默认 `2048`）
- `WEB_TRIGGER_SCAN_FILE`：触发扫描文件名（默认 `.scan_now`）
- `WEB_WATCH_DIRS`：Web 专用监听目录（为空则使用 `.env` 的 `WATCH_DIRS`）
- `WEB_LOG_LIMIT`：日志页默认展示条数（默认 `200`）
- `WEB_UPLOAD_ASR_MODE_DEFAULT`：上传页默认 ASR 模式（默认读取 `.env` 的 `ASR_MODE`）
- `WEB_UPLOAD_SEGMENT_MODE_DEFAULT`：上传页默认切片模式（默认读取 `.env` 的 `SEGMENT_MODE`）
- `WEB_WAL_CHECKPOINT_EVERY`：SQLite WAL 定期 checkpoint 频率（默认 `50` 次写入）
- `WEB_MEDIA_DIRS`：媒体库扫描目录（默认使用 `WATCH_DIRS`）
- `WEB_MEDIA_RECURSIVE`：媒体库是否递归扫描（默认 `true`）
- `WEB_MEDIA_SCAN_CACHE_TTL`：媒体库扫描缓存 TTL 秒（默认 `10`，`0` 关闭缓存）
- `WEB_MEDIA_SCAN_CACHE_PATH`：媒体库扫描缓存路径（默认 `.web/media_scan_cache.json`）
- `WEB_FFPROBE_CACHE_TTL`：ffprobe 缓存 TTL 秒（默认 `3600`，`0` 关闭缓存）
- `WEB_FFPROBE_CACHE_PATH`：ffprobe 缓存路径（默认 `.web/ffprobe_cache.json`）
- `WEB_CONFIG_VERSIONS_PATH`：配置版本存储路径（默认 `.web/config_versions.json`）
- `WEB_ARCHIVE_DIR`：归档目录（设置后归档会移动文件）
- `WEB_ALLOW_DELETE`：允许删除媒体文件（默认 `false`）
- `WEB_METADATA_DIR`：人工元数据保存目录（默认 `metadata`）
- `WEB_MEDIA_SCAN_INTERVAL`：媒体库定时扫描间隔（秒，默认 `0` 不启用）
- `WEB_TRIGGER_SCAN_INTERVAL`：定时触发 worker 扫描间隔（秒，默认 `0` 不启用）
- `WEB_AUTH_ENABLED`：是否启用登录保护（默认 `false`）
- `WEB_AUTH_USER`：登录用户名（默认 `admin`）
- `WEB_AUTH_PASSWORD`：登录密码（默认空）
- `WEB_AUTH_SECRET`：签名密钥（默认 `change-me`）
- `WEB_AUTH_COOKIE`：Cookie 名称（默认 `autosub_auth`）
- `WEB_AUTH_TTL`：登录有效期（秒，默认 `86400`）

Legacy 的 `watcher/web.py` 仍可继续使用。

上传页会为每个文件生成同名任务覆盖文件 `<name>.job.json`，可手工编辑：

```json
{
  "asr_mode": "realtime",
  "segment_mode": "auto"
}
```

字幕编辑保存时会自动备份原文件（`.bak.YYYYmmddHHMMSS`）。

## 配置说明（环境变量）

### Watch/Output
- `WATCH_DIRS`：监听目录（逗号分隔，支持带引号的路径，会自动去引号）
- `WATCH_RECURSIVE`：是否递归监听子目录（默认 `true`）
- `OUT_DIR`：默认 `/output`
- `TMP_DIR`：默认 `/tmp`
- `SCAN_INTERVAL`：默认 `300`
- `LOCK_TTL`：默认 `7200`
- `OUTPUT_TO_SOURCE_DIR`：是否将输出字幕/标记文件写回视频所在目录（默认 `true`）
- `LOG_DIR`：日志文件输出目录（为空则仅输出到 stdout）
- `LOG_FILE_NAME`：日志文件名（默认 `worker.log`）
- `LOG_MAX_BYTES`：日志单文件最大字节数（默认 `10485760`）
- `LOG_MAX_BACKUPS`：日志轮转保留份数（默认 `5`）
- `TRIGGER_SCAN_FILE`：触发扫描的文件名（默认 `.scan_now`）
- `WORKER_CONCURRENCY`：处理线程数（默认 `1`）
- `MAX_ACTIVE_JOBS`：同时处理的任务上限（默认 `WORKER_CONCURRENCY`）
- `FFMPEG_CONCURRENCY`：FFmpeg 并发上限（默认 `1`）
- `QUEUE_PRIORITY_ENABLED`：启用任务优先级队列（默认 `true`）
- `QUEUE_PRIORITY_FAILED`：失败任务优先级（默认 `0`，数值越小越优先）
- `QUEUE_PRIORITY_MISSING_ZH`：缺简中任务优先级（默认 `1`）
- `QUEUE_PRIORITY_DEFAULT`：默认任务优先级（默认 `5`）

### 运行日志与运行记录
- 全局日志：`LOG_DIR/worker.log`
- 单次运行日志：`<name>.<hash>.run.<run_id>.log`
- 运行记录：`<name>.<hash>.run.json`（包含 run_id、阶段、状态、日志路径）

### 手动触发扫描

支持通过信号立即触发一次扫描（不影响定时扫描）：

```bash
# 容器内 PID 为 1 时：
docker kill -s HUP <container>
# 或者
docker kill -s USR1 <container>
```

也支持通过 `docker exec` 触发扫描：

```bash
docker exec <container> sh -c 'touch /watch/.scan_now'
```

### DashScope 百炼
- `DASHSCOPE_API_KEY`：必填
- `ASR_MODEL`：默认 `paraformer-v2`
- `ASR_MODE`：`auto|offline|realtime`（默认 `auto`，自动按模型选择；`realtime` 不依赖 OSS）
- `ASR_REALTIME_MODELS`：实时模型列表（逗号分隔，用于 `auto` 判断）
- `ASR_OFFLINE_MODELS`：离线模型列表（逗号分隔，用于 `auto` 判断）
- `SEGMENT_MODE`：`post|auto`（默认 `post`）
- `ASR_SAMPLE_RATE`：采样率（默认 `16000`）
- `ASR_REALTIME_CHUNK_SECONDS`：实时 ASR 分片时长（秒，默认 `900`）
- `ASR_REALTIME_CHUNK_OVERLAP_MS`：实时 ASR 分片重叠（毫秒，默认 `500`）
- `ASR_REALTIME_RETRY`：实时 ASR 单分片重试次数（默认 `2`）
- `ASR_REALTIME_CHUNK_MIN_SECONDS`：实时 ASR 分片最小时长（秒，默认 `300`）
- `ASR_REALTIME_CHUNK_MAX_SECONDS`：实时 ASR 分片最大时长（秒，默认 `900`）
- `ASR_REALTIME_CHUNK_TARGET`：实时 ASR 目标分片数（默认 `12`）
- `ASR_REALTIME_FAILURE_RATE_THRESHOLD`：失败率阈值触发自适应重试（默认 `0.3`）
- `ASR_REALTIME_ADAPTIVE_RETRY`：是否启用分片自适应重试（默认 `true`）
- `ASR_REALTIME_STREAMING_ENABLED`：实时 ASR 使用流式发送（默认 `false`）
- `ASR_REALTIME_STREAM_FRAME_MS`：实时流式每包时长（毫秒，默认 `100`）
- `ASR_REALTIME_FALLBACK_ENABLED`：失败率过高时启用 VAD 断句重试（默认 `true`）
- `ASR_REALTIME_FALLBACK_MAX_SENTENCE_SILENCE`：VAD 静音阈值（默认 `1200`）
- `ASR_REALTIME_FALLBACK_MULTI_THRESHOLD`：VAD 多阈值防止过长（默认 `true`）
- `ASR_FAIL_COOLDOWN_SECONDS`：ASR 失败冷却时间（秒，默认 `3600`）
- `ASR_MAX_FAILURES`：连续失败上限（默认 `3`，达到后暂停自动重试）
- `ASR_FAIL_ALERT`：ASR 失败强提示日志（默认 `true`）
- `ASR_SEMANTIC_PUNCTUATION_ENABLED`：实时 ASR 语义断句（默认 `false`）
- `ASR_MAX_SENTENCE_SILENCE`：实时 ASR VAD 静音阈值 ms（默认 `800`）
- `ASR_MULTI_THRESHOLD_MODE_ENABLED`：实时 ASR 多阈值防止过长（默认 `false`）
- `ASR_PUNCTUATION_PREDICTION_ENABLED`：实时 ASR 标点预测（默认 `true`）
- `ASR_DISFLUENCY_REMOVAL_ENABLED`：实时 ASR 过滤语气词（默认 `false`）
- `ASR_HEARTBEAT`：实时 ASR 心跳保活（默认 `false`）
- `LANGUAGE_HINTS`：默认 `ja,en`（仅 paraformer-v2 使用）

### OSS
- `OSS_ENDPOINT`：必填
- `OSS_BUCKET`：必填
- `OSS_ACCESS_KEY_ID`：必填
- `OSS_ACCESS_KEY_SECRET`：必填
- `OSS_PREFIX`：默认 `subtitle-audio/`
- `OSS_URL_MODE`：默认 `presign`（可选 `public`）
- `OSS_PRESIGN_EXPIRE`：默认 `86400`
- `DELETE_OSS_OBJECT`：默认 `false`

### 可选
- `SAVE_RAW_JSON`：保存原始识别结果到 `output/*.raw.json`
- `MOVE_DONE`：处理完成后移动视频到 `DONE_DIR`
- `DONE_DIR`：默认 `/watch/done`
- `OUTPUT_LANG_SUFFIX`：输出文件名语言后缀，如 `ja` 会生成 `xxx.ja.srt`

### 翻译（LLM）
- `TRANSLATE`：默认 `true`，是否生成翻译字幕
- `USE_EXISTING_SUBTITLE`：当存在内封/外置字幕且非简体中文时，是否直接用现有字幕生成简体（默认 `true`）
- `SIMPLIFIED_LANG`：简体中文字幕的目标语言标识（默认 `zh`）
- `IGNORE_SIMPLIFIED_SUBTITLE`：忽略简体字幕检测并强制继续翻译（默认 `false`）
- `SUBTITLE_MODE`：字幕轨策略 `ignore|reference|reuse_if_good`（默认 `reuse_if_good`）
- `SUBTITLE_PREFER_LANGS_SRC`：参考字幕优先语言（默认 `jpn,ja`）
- `SUBTITLE_PREFER_LANGS_DST`：复用字幕优先语言（默认 `chi,zh,zh-hans`）
- `SUBTITLE_EXCLUDE_TITLES`：字幕标题排除关键词（默认 `sign,song,karaoke`）
- `SUBTITLE_INDEX`：指定字幕轨 index（留空则自动）
- `SUBTITLE_LANG`：指定字幕轨语言前缀（留空则自动）
- `SUBTITLE_REUSE_MIN_CONFIDENCE`：复用字幕的最低语言置信度阈值（默认 `0.35`）
- `SUBTITLE_REUSE_SAMPLE_CHARS`：复用字幕的采样字符数（默认 `2000`）
- `AUDIO_PREFER_LANGS`：音轨优先语言（默认 `jpn,ja,eng,en`）
- `AUDIO_EXCLUDE_TITLES`：音轨标题排除关键词（默认 `commentary,コメンタリー`）
- `AUDIO_INDEX`：指定音轨 index（留空则自动）
- `AUDIO_LANG`：指定音轨语言前缀（留空则自动）
- `METADATA_ENABLED`：启用外部元数据识别（默认 `false`）
- `METADATA_LANGUAGE_PRIORITY`：元数据语言优先级（默认 `ja-JP,zh-CN,en-US`）
- `METADATA_MIN_CONFIDENCE`：最小置信度（默认 `0.5`）
- `METADATA_MIN_TITLE_SIMILARITY`：标题最低相似度过滤阈值（默认 `0.6`）
- `TITLE_ALIASES_PATH`：作品标题别名映射 YAML 路径（为空则不加载）
- `LLM_TITLE_ALIAS_ENABLED`：是否用 LLM 推断标题别名（默认 `true`）
- `WORK_GLOSSARY_DIR`：作品术语表目录（默认 `glossary`）
- `WORK_GLOSSARY_ENABLED`：是否启用作品术语表自动加载（默认 `true`）
- `ASR_HOTWORDS_ENABLED`：是否启用 ASR 热词（默认 `false`）
- `ASR_HOTWORDS_MAX`：热词最大数量（默认 `50`）
- `ASR_HOTWORDS_LANGS`：允许启用热词的音频语言（默认 `ja,jpn,en,eng,zh,chi`）
- `ASR_HOTWORDS_PARAM`：DashScope 热词参数名（默认 `hot_words`）
- `ASR_HOTWORDS_USE_GLOSSARY`：热词是否包含术语表（默认 `true`）
- `ASR_HOTWORDS_USE_METADATA`：热词是否包含元数据角色名（默认 `true`）
- `ASR_HOTWORDS_USE_TITLE_ALIASES`：热词是否包含标题别名（默认 `true`）
- `ASR_HOTWORDS_MODE`：热词模式 `vocabulary|param`（默认 `vocabulary`）
- `ASR_HOTWORDS_WEIGHT`：热词权重（默认 `4`）
- `ASR_HOTWORDS_PREFIX`：热词词表前缀（默认 `autosub`）
- `ASR_HOTWORDS_TARGET_MODEL`：热词绑定模型（默认空，使用 `ASR_MODEL`）
- `ASR_HOTWORDS_ALLOW_MIXED`：允许多语种热词混用（仅当未指定 `LANGUAGE_HINTS` 时生效，默认 `false`）
- `METADATA_CACHE_TTL`：缓存秒数（默认 `86400`）
- `METADATA_DEBUG`：写入元数据调试 JSON（默认 `false`）
- `TMDB_ENABLED`：启用 TMDb（默认 `true`）
- `TMDB_API_KEY`：TMDb API Key（必填）
- `TMDB_BASE_URL`：TMDb API 地址（默认 `https://api.themoviedb.org/3`）
- `BANGUMI_ENABLED`：启用 Bangumi（默认 `true`）
- `BANGUMI_ACCESS_TOKEN`：Bangumi Access Token（可选）
- `BANGUMI_USER_AGENT`：Bangumi User-Agent（必填）
- `BANGUMI_BASE_URL`：Bangumi API 地址（默认 `https://api.bgm.tv`）
- `WMDB_ENABLED`：启用 WMDB（默认 `false`）
- `WMDB_BASE_URL`：WMDB API 地址（默认 `https://api.wmdb.tv`）
- `PROVIDER_WEIGHT_TMDB`：TMDb 权重（默认 `1.0`）
- `PROVIDER_WEIGHT_BANGUMI`：Bangumi 权重（默认 `0.8`）
- `PROVIDER_WEIGHT_WMDB`：WMDB 权重（默认 `0.5`）
- `SRC_LANG`：默认 `auto`
- `DST_LANG`：默认 `zh`，生成 `output/<name>.<DST_LANG>.srt`
- `DST_LANGS`：逗号分隔多语言列表，如 `zh,en`（优先于 `DST_LANG`）
- `LLM_BASE_URL`：OpenAI-compatible Base URL
- `LLM_API_KEY`：API Key
- `LLM_MODEL`：默认 `deepseek-v3.2`
  - 已验证可用：`deepseek-v3.2`、`qwen3-max-preview`、`qwen3-235b-a22b-thinking-2507`、`kimi-k2-thinking`、`glm-4.7`、`qwen3-next-80b-a3b-thinking`、`qwen3-235b-a22b-instruct-2507`
- `LLM_TEMPERATURE`：默认 `0.2`
- `LLM_MAX_TOKENS`：默认 `1024`
- `BATCH_LINES`：每批行数，默认 `10`
- `MAX_CONCURRENT_TRANSLATIONS`：并发数，默认 `2`
- `TRANSLATE_RETRY`：失败重试次数，默认 `3`
- `MAX_CHARS_PER_LINE`：中文自动换行阈值，默认 `20`
- `BILINGUAL`：是否生成双语字幕 `output/<name>.bi.srt`
- `BILINGUAL_ORDER`：双语顺序 `raw_first|trans_first`
- `BILINGUAL_LANG`：多语言时选择用于双语字幕的目标语言（默认取第一个）
- `USE_POLISH`：是否开启二阶段润色（默认 `false`）
- `POLISH_BATCH_SIZE`：润色上下文窗口大小（默认 `80`）
- `GLOSSARY_PATH`：术语表 YAML 路径（为空则不加载）
- `GLOSSARY_CONFIDENCE_THRESHOLD`：启用作品专属术语表的置信度阈值（默认 `0.75`）
- `MIN_TRANSLATE_DURATION`：小于该时长（秒）的视频跳过翻译（默认 `60`）
- `EVAL_COLLECT`：是否采集评估样本（默认 `false`）
- `EVAL_OUTPUT_DIR`：评估样本输出目录（默认 `eval`，相对 `OUT_DIR`）
- `EVAL_SAMPLE_RATE`：评估采样比例（默认 `1.0`）
- `MANUAL_METADATA_DIR`：人工元数据目录（默认 `metadata`）
- `SRT_VALIDATE`：输出 SRT 校验与修复开关（默认 `true`）
- `SRT_AUTO_FIX`：启用 SRT 自动修复（默认 `true`）
- `LLM_RPS`：LLM 调用速率上限（每秒请求数，默认 `0` 不限）
- `DASHSCOPE_RPS`：ASR 调用速率上限（每秒请求数，默认 `0` 不限）
- `METADATA_RPS`：元数据服务速率上限（每秒请求数，默认 `0` 不限）
- `ASR_MAX_DURATION_SECONDS`：二次切片时每行最长时长（默认 `3.5` 秒）
- `ASR_MAX_CHARS`：二次切片时每行最大字符数（默认 `25`）
- `ASR_MIN_DURATION_SECONDS`：二次切片时每行最短时长（默认 `1.0` 秒）
- `ASR_MIN_CHARS`：二次切片时每行最少字符数（默认 `6`）
- `ASR_MERGE_GAP_MS`：短句合并允许的最大时间间隔（默认 `400` 毫秒）
- `NFO_ENABLED`：是否读取同名 NFO 作为作品信息线索（默认 `false`）
- `NFO_SAME_NAME_ONLY`：只读取与媒体同名的 NFO（默认 `true`）
- `GROUPING_ENABLED`：是否启用语义行分组（默认 `true`）
- `CONTEXT_AWARE_ENABLED`：是否启用带上下文逐行翻译（默认 `true`）

## 与下载器配合
将下载器的完成目录指向本项目的 `watch/`，即可自动生成字幕。

## 输出说明
- 默认输出到视频所在目录（`OUTPUT_TO_SOURCE_DIR=true`）
- 可切换输出到 `output/` 目录（`OUTPUT_TO_SOURCE_DIR=false`）
- 简体中文字幕由 LLM 生成时，文件名为 `name.llm.<lang>.srt`（如 `xxx.llm.zh.srt`）

## 常见问题
- 为什么必须 OSS 公网 URL？
  - 百炼录音识别异步 API 需要可公网访问的音频地址，因此必须先上传 OSS。
- 为什么没有立即处理？
  - 会做“下载完成”检测（5 秒大小不变且大于 1MB），未完成会跳过，等待下一次扫描。

## 术语表（可选）
可选 YAML 文件，用于固定术语翻译：

```yaml
global:
  "ポーネグリフ": "历史正文"
  "覇気": "霸气"
works:
  "ONE PIECE":
    "ニコ・ロビン": "妮可·罗宾"
    "ロビン": "罗宾"
```

设置 `GLOSSARY_PATH` 指向该文件后，会在翻译与润色阶段作为弱提示使用。

## 外部元数据说明
- TMDb 需要自行查看并申请 API Key
- Bangumi 需要设置合理的 User-Agent，Access Token 可选
- WMDB 为实验性数据源，不保证稳定可用
- 本项目不对第三方数据源的可用性与版权负责，请自行确认使用条款
