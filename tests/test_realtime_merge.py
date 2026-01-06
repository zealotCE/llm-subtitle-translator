import srt
from datetime import timedelta

import watcher.worker as worker


def _sub(idx, start, end, text):
    return srt.Subtitle(
        index=idx,
        start=timedelta(milliseconds=start),
        end=timedelta(milliseconds=end),
        content=text,
    )


def test_merge_subtitle_chunks_overlap():
    part1 = [_sub(1, 0, 1000, "A"), _sub(2, 1000, 2000, "B")]
    part2 = [_sub(1, 1500, 2500, "B2"), _sub(2, 2500, 3500, "C")]
    merged = worker.merge_subtitle_chunks([part1, part2], overlap_ms=500)
    assert [sub.content for sub in merged] == ["A", "B", "C"]
    assert merged[0].index == 1
    assert merged[-1].index == len(merged)
