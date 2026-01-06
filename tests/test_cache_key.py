import watcher.worker as worker


def test_cache_key_stable():
    a = worker.cache_key("ja", "zh", "hello")
    b = worker.cache_key("ja", "zh", "hello")
    assert a == b
    c = worker.cache_key("ja", "zh", "hello2")
    assert a != c
