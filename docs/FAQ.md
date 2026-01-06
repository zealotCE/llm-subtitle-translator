# 常见问题（FAQ）

## 什么时候选用「录音识别」，什么时候只翻字幕？

- **优先只翻字幕**：当视频内封或同目录有字幕（且不是简体中文）时，建议启用字幕复用（`USE_EXISTING_SUBTITLE=true`，`SUBTITLE_MODE=reuse_if_good`）。
- **强制录音识别**：当字幕质量差/错位，或没有合适字幕时，建议使用 ASR（`SUBTITLE_MODE=ignore` 或 `USE_EXISTING_SUBTITLE=false`）。
- **只要简体字幕就跳过**：默认检测到简体中文字幕会跳过识别与翻译，可用 `IGNORE_SIMPLIFIED_SUBTITLE=true` 强制继续翻译。

## 名词为什么有时会翻错？

主要取决于“作品识别”和“术语来源”：

- 作品识别不准：会导致加载错误的作品元数据，翻译用错角色译名。
- 外部数据库数据质量：TMDb/Bangumi 的角色名可能存在多版本译名差异。
- 术语表不完整：未命中专名时，LLM 只能靠上下文猜测。

建议：
- 提供更准确的文件名（含季/集信息）。
- 启用/补充 `title_aliases.yaml` 与作品术语表。
- 必要时将 NFO 作为线索（`NFO_ENABLED=true`）。

## 怎么关闭/限制外部 API（隐私或请求量考虑）？

可以通过开关禁用外部服务，或只保留必须的识别与翻译：

- **关闭元数据查询**：`METADATA_ENABLED=false`
- **关闭 TMDb/Bangumi/WMDB**：`TMDB_ENABLED=false`、`BANGUMI_ENABLED=false`、`WMDB_ENABLED=false`
- **关闭 LLM 标题别名推断**：`LLM_TITLE_ALIAS_ENABLED=false`
- **关闭热词**：`ASR_HOTWORDS_ENABLED=false`

如果你只想“字幕翻译”但不想请求外部数据库：

```
METADATA_ENABLED=false
TMDB_ENABLED=false
BANGUMI_ENABLED=false
WMDB_ENABLED=false
LLM_TITLE_ALIAS_ENABLED=false
```

