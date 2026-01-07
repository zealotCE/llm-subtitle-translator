# Pipeline 评估说明

本评估用于对字幕质量与时间对齐进行量化，适合比较不同参数/策略带来的效果变化。

## 评估目标

- **质量**：候选字幕与参考字幕的文字相似度
- **时间对齐**：候选与参考的时间差分布
- **残句占比**：过短行比例（字符数/时长）

## 前置条件

- 候选字幕与参考字幕为同语种
- 参考字幕与媒体版本时间轴尽量一致

## 评估样本采集（可选）

当启用 `EVAL_COLLECT=true` 时，worker 会在检测到简体字幕的情况下仍执行识别/翻译，
并保存评估样本到 `EVAL_OUTPUT_DIR`。样本包含参考字幕、候选字幕与源字幕，便于离线评估。

## 脚本

`scripts/evaluate.py` 用于生成评估报告。

### 基本用法

```bash
python scripts/evaluate.py \
  --candidate test_video/海贼王1149话-带字幕.merge.llm.zh.srt \
  --reference test_video/海贼王1149话-带字幕.chi.srt \
  --output test_video/eval.zh.json \
  --csv test_video/eval.zh.worst.csv
```

### 可选参数

- `--window-ms`：时间匹配窗口（默认 5000）
- `--min-chars`：短句字符阈值（默认 6）
- `--min-duration`：短句时长阈值（默认 1.0 秒）
- `--top-n`：输出最差 N 条（默认 10）

## 输出说明

评估输出为 JSON：

- `candidate_lines` / `reference_lines`：行数
- `time_match`：时间对齐统计（2s 内/窗口内）
- `similarity`：相似度统计（mean/median/p10/p90）
- `short_lines`：残句占比

## 指标解读建议

- **相似度均值偏低**：
  - 语种不一致或翻译风格差异较大
  - 版本差异导致错配
- **时间对齐低**：
  - 片源不同步或字幕切点差异大
  - 参考字幕含大量音乐/说明行
- **残句占比高**：
  - 二次切片过细，可适当放宽参数

## 建议对比流程

1. 先评估“ASR 原文 vs 同语种参考字幕”
2. 再评估“翻译字幕 vs 目标语参考字幕”
3. 调整切片参数后重复评估
