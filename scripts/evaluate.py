#!/usr/bin/env python3
import argparse
import json
import re
import statistics as st
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import List, Optional, Tuple


TIME_RE = re.compile(r"(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})")
INDEX_RE = re.compile(r"^\d+$")


@dataclass
class SubtitleLine:
    start_ms: int
    end_ms: int
    text: str


@dataclass
class EvalPair:
    score: float
    gap_ms: int
    cand: SubtitleLine
    ref: SubtitleLine


def to_ms(ts: str) -> int:
    h, m, rest = ts.split(":")
    s, ms = rest.split(",")
    return (int(h) * 3600 + int(m) * 60 + int(s)) * 1000 + int(ms)


def clean_text(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\{[^}]*\}", "", text)
    text = re.sub(r"^\s*\[\d+\]\s*", "", text)
    text = re.sub(r"^\s*\d+[.)\:]\s*", "", text)
    return text.strip()


def parse_srt(path: Path) -> List[SubtitleLine]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    blocks = re.split(r"\n\s*\n", text.strip())
    items: List[SubtitleLine] = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if len(lines) < 2:
            continue
        if INDEX_RE.match(lines[0]):
            lines = lines[1:]
        if not lines:
            continue
        time_match = TIME_RE.match(lines[0])
        if not time_match:
            continue
        start, end = time_match.group(1), time_match.group(2)
        content = clean_text("\n".join(lines[1:]))
        if not content:
            continue
        items.append(
            SubtitleLine(start_ms=to_ms(start), end_ms=to_ms(end), text=content)
        )
    return items


def nearest_by_time(ref_items: List[SubtitleLine], target_ms: int) -> Tuple[Optional[SubtitleLine], Optional[int]]:
    best = None
    best_gap = None
    for item in ref_items:
        mid = (item.start_ms + item.end_ms) // 2
        gap = abs(mid - target_ms)
        if best is None or gap < best_gap:
            best = item
            best_gap = gap
    return best, best_gap


def eval_pairs(candidate: List[SubtitleLine], reference: List[SubtitleLine]) -> List[EvalPair]:
    pairs: List[EvalPair] = []
    for cand in candidate:
        mid = (cand.start_ms + cand.end_ms) // 2
        ref, gap = nearest_by_time(reference, mid)
        if ref is None or gap is None:
            continue
        score = SequenceMatcher(None, cand.text, ref.text).ratio() if cand.text and ref.text else 0.0
        pairs.append(EvalPair(score=score, gap_ms=int(gap), cand=cand, ref=ref))
    return pairs


def summary_scores(scores: List[float]) -> dict:
    if not scores:
        return {"mean": 0.0, "median": 0.0, "p10": 0.0, "p90": 0.0}
    return {
        "mean": round(st.mean(scores), 3),
        "median": round(st.median(scores), 3),
        "p10": round(st.quantiles(scores, n=10)[0], 3),
        "p90": round(st.quantiles(scores, n=10)[-1], 3),
    }


def short_line_stats(items: List[SubtitleLine], min_chars: int, min_duration: float) -> dict:
    if not items:
        return {"short_chars": 0, "short_time": 0, "short_chars_ratio": 0.0, "short_time_ratio": 0.0}
    short_chars = 0
    short_time = 0
    for item in items:
        if len(item.text) < min_chars:
            short_chars += 1
        duration = (item.end_ms - item.start_ms) / 1000.0
        if duration < min_duration:
            short_time += 1
    total = len(items)
    return {
        "short_chars": short_chars,
        "short_time": short_time,
        "short_chars_ratio": round(short_chars / total, 3),
        "short_time_ratio": round(short_time / total, 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate subtitle quality with a reference SRT.")
    parser.add_argument("--candidate", required=True, help="Candidate SRT path")
    parser.add_argument("--reference", required=True, help="Reference SRT path (same language)")
    parser.add_argument("--name", default="", help="Optional name for report")
    parser.add_argument("--window-ms", type=int, default=5000, help="Time match window in ms")
    parser.add_argument("--min-chars", type=int, default=6, help="Short line threshold (chars)")
    parser.add_argument("--min-duration", type=float, default=1.0, help="Short line threshold (seconds)")
    parser.add_argument("--top-n", type=int, default=10, help="Show worst/best N pairs")
    parser.add_argument("--output", default="", help="Output JSON path")
    parser.add_argument("--csv", default="", help="Output CSV path for worst pairs")
    args = parser.parse_args()

    cand_path = Path(args.candidate)
    ref_path = Path(args.reference)
    candidate = parse_srt(cand_path)
    reference = parse_srt(ref_path)

    pairs = eval_pairs(candidate, reference)
    scores = [p.score for p in pairs]
    gaps = [p.gap_ms for p in pairs]

    within_2s = sum(1 for g in gaps if g <= 2000)
    within_5s = sum(1 for g in gaps if g <= args.window_ms)
    total_pairs = len(pairs)

    report = {
        "name": args.name,
        "candidate": str(cand_path),
        "reference": str(ref_path),
        "candidate_lines": len(candidate),
        "reference_lines": len(reference),
        "pairs": total_pairs,
        "time_match": {
            "within_2s": within_2s,
            "within_2s_ratio": round(within_2s / total_pairs, 3) if total_pairs else 0.0,
            "within_window_ms": within_5s,
            "within_window_ratio": round(within_5s / total_pairs, 3) if total_pairs else 0.0,
            "window_ms": args.window_ms,
        },
        "similarity": summary_scores(scores),
        "short_lines": short_line_stats(candidate, args.min_chars, args.min_duration),
    }

    print(json.dumps(report, ensure_ascii=False, indent=2))

    if args.output:
        Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.csv:
        worst = sorted(pairs, key=lambda p: p.score)[: args.top_n]
        lines = ["score,gap_ms,cand_start,cand_end,cand_text,ref_start,ref_end,ref_text"]
        for p in worst:
            lines.append(
                f"{p.score:.3f},{p.gap_ms},{p.cand.start_ms},{p.cand.end_ms},"
                f"{json.dumps(p.cand.text, ensure_ascii=False)},"
                f"{p.ref.start_ms},{p.ref.end_ms},"
                f"{json.dumps(p.ref.text, ensure_ascii=False)}"
            )
        Path(args.csv).write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
