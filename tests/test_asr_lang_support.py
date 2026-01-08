import watcher.worker as worker


def test_asr_lang_support_allows_auto_by_default():
    assert worker.is_asr_lang_supported("auto") is True


def test_asr_lang_support_rejects_unlisted(monkeypatch):
    monkeypatch.setattr(worker, "ASR_SUPPORTED_LANGS", ["ja", "zh"])
    assert worker.is_asr_lang_supported("de") is False


def test_asr_lang_support_accepts_listed(monkeypatch):
    monkeypatch.setattr(worker, "ASR_SUPPORTED_LANGS", ["ja", "zh"])
    assert worker.is_asr_lang_supported("jpn") is True
