import watcher.worker as worker


def test_queue_priority_failed(tmp_path, monkeypatch):
    video = tmp_path / "movie.mp4"
    video.write_text("x", encoding="utf-8")
    failed = tmp_path / "movie.translate_failed.zh.log"
    failed.write_text("fail", encoding="utf-8")

    monkeypatch.setattr(worker, "SIMPLIFIED_LANG", "zh")
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_FAILED", 0)
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_MISSING_ZH", 1)
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_DEFAULT", 5)
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_ENABLED", True)
    monkeypatch.setattr(worker, "output_dir_for", lambda _path: str(tmp_path))

    assert worker._compute_queue_priority(str(video)) == 0


def test_queue_priority_missing_zh(tmp_path, monkeypatch):
    video = tmp_path / "movie.mp4"
    video.write_text("x", encoding="utf-8")

    monkeypatch.setattr(worker, "SIMPLIFIED_LANG", "zh")
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_FAILED", 0)
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_MISSING_ZH", 1)
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_DEFAULT", 5)
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_ENABLED", True)
    monkeypatch.setattr(worker, "output_dir_for", lambda _path: str(tmp_path))

    assert worker._compute_queue_priority(str(video)) == 1


def test_queue_priority_default(tmp_path, monkeypatch):
    video = tmp_path / "movie.mp4"
    video.write_text("x", encoding="utf-8")
    zh = tmp_path / "movie.zh.srt"
    zh.write_text("hello", encoding="utf-8")

    monkeypatch.setattr(worker, "SIMPLIFIED_LANG", "zh")
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_FAILED", 0)
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_MISSING_ZH", 1)
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_DEFAULT", 5)
    monkeypatch.setattr(worker, "QUEUE_PRIORITY_ENABLED", True)
    monkeypatch.setattr(worker, "output_dir_for", lambda _path: str(tmp_path))

    assert worker._compute_queue_priority(str(video)) == 5
