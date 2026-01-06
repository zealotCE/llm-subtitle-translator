import watcher.worker as worker


def test_build_asr_hotwords_basic():
    worker.ASR_HOTWORDS_ENABLED = True
    worker.ASR_HOTWORDS_USE_GLOSSARY = True
    worker.ASR_HOTWORDS_USE_TITLE_ALIASES = True
    worker.ASR_HOTWORDS_USE_METADATA = False
    try:
        hotwords = worker.build_asr_hotwords(None, {"海贼王": "x"}, ["ワンピース"], "ja")
        assert "ワンピース" in hotwords
    finally:
        worker.ASR_HOTWORDS_ENABLED = False
