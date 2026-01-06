import watcher.worker as worker


def test_normalize_lang_for_asr():
    assert worker._normalize_lang_for_asr("jpn") == "ja"
    assert worker._normalize_lang_for_asr("ja-JP") == "ja"
    assert worker._normalize_lang_for_asr("eng") == "en"
    assert worker._normalize_lang_for_asr("zh-CN") == "zh"


def test_hotword_text_validation():
    assert worker._valid_hotword_text("こんにちは") is True
    assert worker._valid_hotword_text("Exothermic reaction") is True
    assert worker._valid_hotword_text("The effect of temperature variations on enzyme activity in biochemical reactions") is False
