# 下一个里程碑（草案）

本文档汇总“Web 管理与上传平台 + 实时 ASR + 媒体/字幕管理”的整体设计草案，供评审与拆解任务。

## 目标与范围

- **目标**：提供 Web 界面进行配置、上传、字幕查看/编辑与媒体管理；支持实时 ASR 与离线 ASR 并行；可人工补全媒体元数据。
- **不在本阶段**：复杂权限系统、外部账号体系、多租户、全量搜索与复杂统计报表。

## 用户流程

1) 管理员登录 → 设置页配置（等同 .env）
2) 上传视频/音频 → 选择识别模式（离线/实时）→ 创建任务
3) 任务队列查看 → 处理完成后进入字幕查看/编辑
4) 保存字幕版本 → 导出/下载
5) 媒体库管理：归档、清理、标签
6) 元数据补全：人工选择作品、修正标题/季/集

## 功能清单

### A. 设置管理（Web）
- 基本配置编辑（等同 .env）
- 分类：ASR、翻译、OSS、元数据、日志、扫描
- 标记“需要重启”与“可热更新”参数

### B. 上传与任务管理
- 上传视频/音频（多文件）
- 任务列表（队列/处理中/失败/完成）
- 任务详情：日志、产物、错误信息
- 支持重试/取消/删除任务
- 手动触发扫描/任务（Web 入口）
- 并发控制与资源限制（Web 可配置）

### C. 字幕查看与编辑
- SRT 预览
- 基础编辑：逐行文本修改、合并/拆分、时间调整
- 版本管理：保留历史版本，可回滚

### D. 媒体管理
- 媒体列表 + 标签
- 归档/清理策略（避免无序扩张）
- 与任务/字幕关联

### E. 元数据补全（人工）
- 展示作品候选列表（TMDb/Bangumi/WMDB）
- 人工确认/修正标题、季/集、角色名
- 结果写入本地缓存/术语表

### F. ASR 路径并行
- `ASR_MODE=offline`：OSS + Paraformer
- `ASR_MODE=realtime`：FunASR Realtime
- `SEGMENT_MODE=auto|post`：实时断句或二次切片
- `LANGUAGE_HINTS` 保持一致
- 失败不自动回退（用户手动切换）

### G. 评估数据采集（默认关闭）

- 当 `EVAL_COLLECT=true` 时启用
- 若存在简体中文字幕，仍执行 ASR/翻译并保存评估样本
- 保存参考字幕/候选字幕/源字幕与统计报告

## 后端设计草案

### 核心实体

- `Job`
  - `id, status, asr_mode, segment_mode, src_lang, dst_langs, created_at, updated_at`
  - `input_path, media_id, error, logs`
  - `trigger_source`：`inotify|scan|web`
  - `log_path`：指向 JSON Lines 日志
  - `eval_enabled`：是否采集评估数据

- `Media`
  - `id, filename, size, duration, audio_tracks, subtitle_tracks, labels, archived`

- `Subtitle`
  - `id, job_id, lang, version, content, created_at`

- `Metadata`
  - `media_id, work_title, season, episode, external_ids, confidence`

- `Config`
  - key/value 配置映射（与 .env 对齐）

- `EvaluationSample`
  - `media_id, candidate_path, reference_path, source_path, report_path`

### 模块划分

- `api/`：REST API
- `services/`：任务执行、字幕处理、元数据
- `storage/`：文件与 DB 接口
- `workers/`：异步任务队列（可先用本地线程 + 任务表）
- `logs/`：日志落盘与检索接口（可读 LOG_DIR）
- `eval/`：评估数据采集与对齐统计

## API 草案（简版）

- `POST /api/jobs`：创建任务（上传后）
- `POST /api/jobs/batch`：批量创建任务
- `GET /api/jobs`：任务列表
- `GET /api/jobs/{id}`：任务详情
- `POST /api/jobs/{id}/retry`：重试
- `POST /api/scan`：手动触发一次扫描
- `GET /api/media`：媒体列表
- `GET /api/media/{id}`：媒体详情
- `GET /api/subtitles/{id}`：字幕内容
- `PUT /api/subtitles/{id}`：字幕编辑保存
- `GET /api/config` / `PUT /api/config`
- `POST /api/metadata/resolve`：人工确认元数据
- `GET /api/logs`：按 `job_id` / `path` 查询日志
- `GET /api/eval`：评估样本列表
- `GET /api/eval/{id}`：评估样本详情

## 前端页面

- Dashboard（任务队列）
- Upload（上传与参数）
- Media Library（列表+管理）
- Subtitle Editor（查看/编辑/历史）
- Settings（配置）
- Metadata Panel（作品识别/修正）

## 里程碑拆分（建议）

### M1：Web + 任务队列（最小可用）
- 上传 → 任务 → 结果下载
- 只读字幕预览
- 任务与日志可视化（自动触发任务也入库）
- 并发控制参数可配置（最小版）

### M2：字幕编辑 + 版本历史
- 基本编辑、合并/拆分
- 保存版本

### M3：媒体管理
- 归档/清理策略
- 媒体标签与关联

### M4：元数据补全 + 术语表
- 手动确认作品
- 生成作品术语表

### M4.5：评估数据采集
- 支持 `EVAL_COLLECT` 开关与样本存档
- Web 查看评估样本与报告

### M5：实时 ASR
- FunASR Realtime 路径上线
- 支持长视频分片

## 风险与注意点

- 字幕编辑体验（时间轴对齐）是高风险大成本
- 实时 ASR 对网络稳定性依赖较强
- 配置热更新需明确哪些项可即时生效
- 评估样本可能包含原字幕内容，需提示用户自行合规保存

## 技术栈建议（拟）

后端：
- FastAPI（异步友好、文档完善）
- SQLite 起步，后续可切换 PostgreSQL
- 后台任务：先用本地队列/线程池，后续可升级到 Celery/RQ

前端：
- Next.js 或 Vite + React
- 组件库：shadcn/ui（可与现有设计系统融合）
- 字幕编辑器：轻量自研 + 逐步增强，必要时评估开源编辑器集成

部署：
- Docker/Compose 为主，NAS 直接部署
- GHCR 镜像分发
