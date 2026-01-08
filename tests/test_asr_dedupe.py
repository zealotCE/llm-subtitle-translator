import watcher.worker as worker


def test_post_process_asr_dedupes_identical_segments():
    result = {
        "transcripts": [
            {
                "sentences": [
                    {"begin_time": 0, "end_time": 1000, "text": "你好"},
                    {"begin_time": 0, "end_time": 1000, "text": "你好"},
                    {"begin_time": 1000, "end_time": 2000, "text": "世界"},
                ]
            }
        ]
    }
    segments = worker.post_process_asr_result(
        result,
        max_duration_seconds=3.5,
        max_chars=25,
        min_duration_seconds=1.0,
        min_chars=1,
        merge_gap_ms=400,
    )
    assert len(segments) == 2
    assert segments[0]["text"] == "你好"
    assert segments[1]["text"] == "世界"


def test_post_process_asr_prefers_japanese_for_same_time():
    result = {
        "transcripts": [
            {
                "sentences": [
                    {"begin_time": 0, "end_time": 1000, "text": "你好"},
                    {"begin_time": 0, "end_time": 1000, "text": "おはよう"},
                ]
            }
        ]
    }
    segments = worker.post_process_asr_result(
        result,
        max_duration_seconds=3.5,
        max_chars=25,
        min_duration_seconds=1.0,
        min_chars=1,
        merge_gap_ms=400,
    )
    assert len(segments) == 1
    assert segments[0]["text"] == "おはよう"
