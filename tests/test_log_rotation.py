import watcher.worker as worker


def test_log_rotation(tmp_path, monkeypatch):
    original_dir = worker.LOG_DIR
    original_name = worker.LOG_FILE_NAME
    original_bytes = worker.LOG_MAX_BYTES
    original_backups = worker.LOG_MAX_BACKUPS

    monkeypatch.setattr(worker, "LOG_DIR", str(tmp_path))
    monkeypatch.setattr(worker, "LOG_FILE_NAME", "worker.log")
    monkeypatch.setattr(worker, "LOG_MAX_BYTES", 10)
    monkeypatch.setattr(worker, "LOG_MAX_BACKUPS", 2)

    log_path = tmp_path / "worker.log"
    log_path.write_text("x" * 20, encoding="utf-8")

    try:
        worker.log("INFO", "rotate_test")
        assert (tmp_path / "worker.log.1").exists()
    finally:
        monkeypatch.setattr(worker, "LOG_DIR", original_dir)
        monkeypatch.setattr(worker, "LOG_FILE_NAME", original_name)
        monkeypatch.setattr(worker, "LOG_MAX_BYTES", original_bytes)
        monkeypatch.setattr(worker, "LOG_MAX_BACKUPS", original_backups)
