import watcher.worker as worker


def test_extract_year():
    assert worker._extract_year("2024-01-01") == 2024
    assert worker._extract_year("1999") == 1999
    assert worker._extract_year("unknown") is None
