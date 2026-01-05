# llm-subtitle-translator

## 功能概览
- 监听 `watch/` 目录：新文件写入完成或移动入目录后自动处理
- 定时扫描兜底：容器重启后仍能补处理旧文件
- 视频抽取音频 → 上传 OSS → 百炼 Paraformer 异步识别 → 生成 SRT
- 跳过已处理文件（`.srt`/`.done`/`.lock`）并清理过期锁

## 目录结构
- `watch/`：待处理视频
- `output/`：输出字幕与标记文件
- `watcher/`：处理服务代码

## 快速开始
1. 复制配置文件：
   ```bash
   cp .env.example .env
   ```
2. 填写 `.env` 里的 DashScope 与 OSS 配置（不要提交密钥）
3. 启动服务：
   ```bash
   docker compose up -d --build
   ```
4. 把视频放入 `watch/`，字幕会输出到 `output/`

## 配置说明（环境变量）

### Watch/Output
- `WATCH_DIR`：默认 `/watch`
- `OUT_DIR`：默认 `/output`
- `TMP_DIR`：默认 `/tmp`
- `SCAN_INTERVAL`：默认 `300`
- `LOCK_TTL`：默认 `7200`

### DashScope 百炼
- `DASHSCOPE_API_KEY`：必填
- `ASR_MODEL`：默认 `paraformer-v2`
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
- `SRC_LANG`：默认 `auto`
- `DST_LANG`：默认 `zh`，生成 `output/<name>.<DST_LANG>.srt`
- `DST_LANGS`：逗号分隔多语言列表，如 `zh,en`（优先于 `DST_LANG`）
- `LLM_BASE_URL`：OpenAI-compatible Base URL
- `LLM_API_KEY`：API Key
- `LLM_MODEL`：默认 `deepseek-v3.2`
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

## 与下载器配合
将下载器的完成目录指向本项目的 `watch/`，即可自动生成字幕。

## 输出说明
- `output/<视频名>.srt`：字幕文件
- `output/<视频名>.done`：完成标记
- `output/<视频名>.lock`：处理中锁文件

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
