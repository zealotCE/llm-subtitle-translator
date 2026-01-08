# 处理流程详解（Pipeline）

本文档详细说明字幕工厂的完整运行逻辑，便于排查问题与后续交接。

## 0. 核心依赖与前置条件

- ASR：高度依赖阿里百炼（DashScope）。实时/离线识别都需要 DashScope API。
- OSS：仅离线录音识别需要（上传音频 → 异步识别）。
- LLM：翻译与术语推断（OpenAI 兼容 API）。
- ffmpeg/ffprobe：音频抽取与媒体探测。

## 1. 入口与扫描机制

### 1.1 监听与补扫

- inotify：监听文件写入完成/移动事件。
- 定时扫描：`SCAN_INTERVAL` 兜底补处理。
- 触发扫描：
  - `TRIGGER_SCAN_FILE`（例如 `.scan_now`）
  - 信号触发（HUP / USR1）

### 1.2 稳定文件判定

- 文件写入未完成会被跳过（防止半成品处理）。
- 锁文件 `.lock` 防止重复处理；过期锁会被清理。

## 2. 任务筛选与跳过逻辑

### 2.1 默认跳过条件

- 已存在 `.done` → 跳过
- 已存在 `.srt`（且不输出到源目录）→ 跳过
- `.lock` 存在且未过期 → 跳过

### 2.2 简体字幕跳过

当检测到简体中文字幕时默认跳过识别与翻译：

- 内嵌字幕轨（文本型）
- 同目录外挂字幕（文本型）
- 已生成的 `name.zh.srt` / `name.llm.zh.srt`

可通过 `IGNORE_SIMPLIFIED_SUBTITLE=true` 强制继续翻译。

### 2.3 ASR 失败保护

- 失败冷却：`ASR_FAIL_COOLDOWN_SECONDS`
- 失败上限：`ASR_MAX_FAILURES`
- 强提示日志：`ASR_FAIL_ALERT=true`

达到失败上限后会标记 `fatal`，自动扫描将跳过，避免反复计费。

## 3. 媒体探测与轨道选择

### 3.1 探测

使用 `ffprobe` 提取：

- 音轨列表（语言、标题、默认、声道）
- 字幕轨列表（语言、标题、编码、图像型）

### 3.2 音轨选择

优先级（从高到低）：

1. 用户指定 index / 语言
2. `prefer_langs` 语言优先
3. default 标记
4. 声道数

### 3.3 字幕轨选择

支持 3 种模式：

- `ignore`：不使用字幕
- `reference`：选一条作为参考，不直接复用
- `reuse_if_good`：目标语言字幕可直接复用（文本型）

同时支持外挂字幕与内嵌字幕。

## 4. ASR 路径（离线 / 实时）

### 4.1 模式判定

`ASR_MODE=auto` 时，按模型列表决定：

- `ASR_REALTIME_MODELS` → realtime
- `ASR_OFFLINE_MODELS` → offline

### 4.2 离线路径（offline）

1. ffmpeg 抽取音轨为 WAV
2. 上传 OSS
3. DashScope 异步识别
4. 下载识别结果并解析

### 4.3 实时路径（realtime）

1. ffmpeg 抽取音轨为 WAV
2. 按时长分片（或流式）
3. DashScope 实时识别
4. 失败率过高则：
   - 缩短分片重试
   - 再失败则切 VAD 断句重试

### 4.4 识别结果解析

支持：

- `sentences` / `words` 两种字段结构
- `transcription_url` 回传解析

解析失败会输出详细错误（含响应片段）。

## 5. 智能二次切片（Post Process）

识别原句通常较长，需再切分：

- 单行最长时长：`ASR_MAX_DURATION_SECONDS`
- 单行最大字符：`ASR_MAX_CHARS`
- 最短行约束：`ASR_MIN_DURATION_SECONDS` / `ASR_MIN_CHARS`
- 优先按标点断句
- 过短片段自动合并

输出为稳定的 SRT 行序列。

## 6. 翻译与上下文增强

### 6.1 行分组

使用时间间隔 + 标点 + 短句规则进行分组：

- 形成 `group_id`
- 组内串联文本作为上下文

### 6.2 上下文翻译

翻译当前行时携带：

- 同组完整原文
- 前后行

保证“一行输入 → 一行输出”，避免拆分/合并。

### 6.3 术语来源

优先级：

1. 手工 glossary
2. 作品专属 glossary
3. 元数据（TMDb/Bangumi/WMDB）

## 7. 输出与产物

- 原始字幕：`name.srt`
- 简体字幕：`name.llm.zh.srt` / `name.zh.srt`
- 双语字幕：`name.bi.srt`（可选）
- 标记：`name.done`
- 失败日志：`name.translate_failed*.log`
- 运行记录：`name.<hash>.run.json`
- 单次运行日志：`name.<hash>.run.<run_id>.log`

## 8. Web UI 的状态同步

Web UI 会扫描目录并同步：

- Media item（文件）
- Outputs（字幕产物）
- Runs（运行记录）
- Activity（活动/事件）

运行失败上限会触发 Activity `asr_failed_fatal`。

## 9. 排障建议

- ASR 失败：先看 `run.log` 与 `worker.log`
- 重复计费：检查 `ASR_MAX_FAILURES` 与冷却时间
- 运行一直 running：检查 `run.json` 和是否有 `.lock` 过期
- 字幕复用失败：检查 `SUBTITLE_MODE` 与置信度阈值
