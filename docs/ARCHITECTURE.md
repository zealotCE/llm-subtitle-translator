# 架构说明

本文档说明本项目的核心组件、数据流与关键设计决策，便于维护与扩展。

## 总体目标

- 监听本地目录，自动处理新增视频
- 选择单一主音轨（避免多音轨混合）
- 优先复用已有字幕（按策略选择），否则走 ASR + LLM 翻译
- 稳定跳过已处理文件，失败不影响整体服务
- 结构化日志，便于定位问题

## 组件概览

```
[Watch Dir(s)]
     |
     | (inotify + 定时扫描)
     v
[watcher/worker.py]
     |-- 独立运行日志（每次 run 单独文件）
     |-- 媒体探测 (ffprobe)
     |-- 音轨选择
     |-- 字幕选择/复用
     |-- ASR (DashScope Paraformer)
     |-- 二次切片 (智能分行)
     |-- 行分组 + 上下文翻译 (LLM)
     v
[输出字幕 + .done + 日志]
```

外部依赖：
- OSS：音频上传与回传识别
- DashScope Paraformer：录音文件识别
- LLM：翻译与术语推断
- TMDb/Bangumi/WMDB：作品元数据（可选）

## 运行与目录结构

- `watch/`：待处理视频
- `output/`：中间产物/缓存（若 `OUTPUT_TO_SOURCE_DIR=false`）
- `watcher/`：主处理服务
- `logs/`：全局日志输出目录（`worker.log`）
- `docs/`：文档
- `web/`：Web UI（媒体库/活动/设置/字幕）

Docker 运行：`docker-compose.yml` 启动 `watcher` 服务。

## 核心流程

### 1. 监听与补处理

- 使用 `inotifywait` 监听写入完成与移动事件
- 定时扫描 `WATCH_DIRS` 兜底补处理
- Web 侧使用扫描缓存（TTL）避免频繁全量 walk
- 支持触发文件（`TRIGGER_SCAN_FILE`）与信号触发即时扫描
- `.lock` 控制并发与重复处理，支持过期清理
- 队列支持优先级（失败/缺简中任务优先处理）

### 2. 媒体探测与选择

- `probe_media(path)` 读取音轨/字幕轨
- 音轨选择：优先语言 + 默认标记 + 声道数
- 字幕策略：
  - `ignore`：忽略所有字幕轨
  - `reference`：选一条做参考（不直接复用）
  - `reuse_if_good`：优先选目标语言字幕复用

### 3. 字幕复用与跳过逻辑

- 检测简体中文字幕时默认跳过识别/翻译（可通过开关忽略）
- 非简体字幕可直接复用并翻译为简体
- 若无可用字幕，进入 ASR
- 字幕复用支持置信度阈值，低于阈值自动回退 ASR

### 4. ASR 与二次切片

- 抽取单一音轨 → 上传 OSS → Paraformer 异步识别
- 识别结果经“智能二次切片”：
  - 限制单行时长/字符数
  - 优先按标点切分
  - 过短片段自动合并

### 5. 行分组与上下文翻译

- 行分组：用时距+标点+短句规则聚为语义组
- 上下文翻译：翻译当前行时带上组内前后行与完整原文
- 术语表：
  - 通用术语表
  - 作品专属术语表
  - 元数据角色名（可选）

### 6. 元数据增强（可选）

- `MetadataService` 聚合 TMDb/Bangumi/WMDB
- 结果生成 `WorkMetadata` 与 `WorkGlossary`
- 作为 LLM 翻译提示，增强专名一致性
- 全流程 best-effort，失败不影响主流程

### 7. 产物与标记

- 字幕：`name.srt` / `name.llm.<lang>.srt`
- 双语：`name.bi.srt`（可选）
- 标记：`name.done`
- 失败日志：`name.translate_failed*.log`
- 运行记录：`name.<hash>.run.json`
- 单次运行日志：`name.<hash>.run.<run_id>.log`
- 全局日志支持轮转（`LOG_MAX_BYTES` / `LOG_MAX_BACKUPS`）

## 关键设计决策

- **单音轨处理**：避免多音轨混合导致错位
- **字幕复用策略化**：复用/参考/忽略可切换
- **二次切片 + 合并短句**：减少残句，提高翻译上下文
- **错误隔离**：单文件失败不阻塞整体服务
- **独立运行日志**：每次运行独立 log，便于定位阶段失败
- **配置化与无密钥内置**：所有密钥由 `.env` 注入

## 扩展点

- 新增元数据源：实现 `WorkMetadataProvider`
- 新增评估脚本：对齐与质量评分
- 新增术语抽取：多字幕轨对齐 → 术语表

## 未来规划：实时 ASR 路径

为支持长视频的实时识别，计划引入 FunASR Realtime（Paraformer/FunASR 实时 SDK），与现有离线 OSS 流程并行。

配置方向（拟）：

- `ASR_MODE`：`offline`（现有 OSS + Paraformer）/`realtime`（实时 SDK）
- `SEGMENT_MODE`：`auto`（实时断句）/`post`（我们的二次切片）
- `LANGUAGE_HINTS`：沿用当前语言提示参数

行为约束：

- 长视频也支持实时 ASR（分片/流式）
- 实时 ASR 失败不自动回退到离线模式，由用户手动切换
