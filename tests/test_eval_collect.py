import watcher.worker as worker


def test_should_collect_eval(monkeypatch):
    monkeypatch.setattr(worker, "EVAL_COLLECT", True)
    monkeypatch.setattr(worker, "EVAL_SAMPLE_RATE", 0.0)
    assert worker.should_collect_eval("/tmp/a.mp4") is False
    monkeypatch.setattr(worker, "EVAL_SAMPLE_RATE", 1.0)
    assert worker.should_collect_eval("/tmp/a.mp4") is True
