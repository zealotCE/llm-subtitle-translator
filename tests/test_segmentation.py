import watcher.worker as worker


def test_merge_short_segments_cjk():
    segments = [
        {"start_ms": 0, "end_ms": 400, "text": "あ"},
        {"start_ms": 450, "end_ms": 2000, "text": "こんにちは"},
    ]
    merged = worker.merge_short_segments(
        segments,
        min_duration_seconds=1.0,
        min_chars=2,
        max_duration_seconds=3.5,
        max_chars=25,
        max_gap_ms=200,
    )
    assert len(merged) == 1
    assert merged[0]["text"] == "あこんにちは"
    assert merged[0]["start_ms"] == 0
    assert merged[0]["end_ms"] == 2000


def test_segment_sentences_by_punctuation():
    sentences = [
        {
            "words": [
                {"begin_time": 0, "end_time": 500, "text": "こんにちは", "punctuation": "。"},
                {"begin_time": 600, "end_time": 1000, "text": "世界", "punctuation": ""},
            ]
        }
    ]
    segments = worker.segment_sentences_to_subtitles(sentences, max_duration_seconds=3.5, max_chars=25)
    assert len(segments) == 2
    assert segments[0]["text"] == "こんにちは。"
    assert segments[1]["text"] == "世界"
