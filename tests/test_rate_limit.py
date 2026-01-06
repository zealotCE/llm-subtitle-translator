import watcher.worker as worker


def test_rate_limit_noop(monkeypatch):
    monkeypatch.setattr(worker, "_RATE_LIMIT_STATE", {})
    worker.rate_limit("llm", 0)
