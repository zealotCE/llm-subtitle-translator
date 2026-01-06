import watcher.worker as worker


def test_nfo_disabled_by_default():
    assert worker.NFO_ENABLED is False
