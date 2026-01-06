import watcher.worker as worker


def test_build_hotword_items_basic():
    items = worker.build_hotword_items(["こんにちは"], "ja")
    assert items and items[0]["text"] == "こんにちは"


def test_build_hotword_items_disallow_hints():
    original = worker.LANGUAGE_HINTS
    worker.LANGUAGE_HINTS = ["en"]
    try:
        items = worker.build_hotword_items(["こんにちは"], "ja")
        assert items == []
    finally:
        worker.LANGUAGE_HINTS = original
