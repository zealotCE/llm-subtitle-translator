import watcher.worker as worker


def test_guess_lang_from_label():
    assert worker.guess_lang_from_label("Japanese") == "jpn"
    assert worker.guess_lang_from_label("eng") == "eng"
    assert worker.guess_lang_from_label("简体中文") == "chi"
    assert worker.guess_lang_from_label("unknown") is None
