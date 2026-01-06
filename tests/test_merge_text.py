import watcher.worker as worker


def test_merge_text_cjk():
    assert worker._merge_text("你好", "世界") == "你好世界"


def test_merge_text_english():
    assert worker._merge_text("Hello", "world") == "Hello world"
