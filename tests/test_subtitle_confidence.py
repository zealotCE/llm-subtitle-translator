import watcher.worker as worker


def test_estimate_lang_confidence():
    ja_text = "こんにちは世界"
    en_text = "Hello world"
    zh_text = "你好世界"

    assert worker._estimate_lang_confidence(ja_text, "ja") > 0.5
    assert worker._estimate_lang_confidence(en_text, "en") > 0.5
    assert worker._estimate_lang_confidence(zh_text, "zh") > 0.5


def test_select_reuse_confidence_prefers_hints():
    text = "Hello world"
    conf_en = worker._select_reuse_confidence(text, ["en"])
    conf_ja = worker._select_reuse_confidence(text, ["ja"])
    assert conf_en > conf_ja
