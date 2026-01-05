# Agent Instructions

- 所有沟通使用中文。
- 目标项目：Docker 化的本地自动字幕工厂，监听 `watch/` 目录，将视频转为音频后上传 OSS，并调用阿里百炼 Paraformer 异步识别生成 SRT。
- 必须具备：inotify 监听 + 定时扫描补处理、稳定跳过已处理文件、锁文件与过期清理、失败不影响整体服务、结构化日志。
- 输出与配置：实现 `docker-compose.yml`、`watcher/Dockerfile`、`watcher/worker.py`、`.env.example`、README（包含使用说明与常见问题）。
- 安全要求：不要把任何密钥或真实凭据写入代码或配置示例中；仅使用占位符。
