import watcher.worker as worker


def test_build_srt_with_sentences():
    response = {
        "output": {
            "results": [
                {
                    "transcripts": [
                        {
                            "sentences": [
                                {
                                    "sentence_id": 1,
                                    "begin_time": 0,
                                    "end_time": 1500,
                                    "text": "こんにちは世界",
                                    "words": [
                                        {"begin_time": 0, "end_time": 700, "text": "こんにちは", "punctuation": "。"},
                                        {"begin_time": 800, "end_time": 1500, "text": "世界", "punctuation": ""},
                                    ],
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    }
    subs, srt_text = worker.build_srt(response)
    assert len(subs) == 1
    assert "こんにちは。世界" in srt_text


def test_build_srt_with_words_only():
    response = {
        "output": {
            "results": [
                {
                    "transcripts": [
                        {
                            "words": [
                                {"begin_time": 0, "end_time": 500, "text": "hello", "punctuation": ""},
                                {"begin_time": 500, "end_time": 1000, "text": "world", "punctuation": "!"},
                            ]
                        }
                    ]
                }
            ]
        }
    }
    subs, _ = worker.build_srt(response)
    assert len(subs) >= 1
    assert "hello" in subs[0].content
    assert "world" in subs[0].content
