import os
from pathlib import Path

import watcher.worker as worker


def test_check_trigger_files(tmp_path: Path):
    marker = tmp_path / ".scan_now"
    marker.write_text("x", encoding="utf-8")
    original = worker.WATCH_DIR_LIST
    original_name = worker.TRIGGER_SCAN_FILE
    worker.WATCH_DIR_LIST = [str(tmp_path)]
    worker.TRIGGER_SCAN_FILE = ".scan_now"
    try:
        assert worker._check_trigger_files() is True
        assert not marker.exists()
    finally:
        worker.WATCH_DIR_LIST = original
        worker.TRIGGER_SCAN_FILE = original_name


def test_scan_once_logs_when_empty(tmp_path: Path, monkeypatch):
    logs = []

    def fake_log(level, message, **kwargs):
        logs.append((level, message, kwargs))

    original_dirs = worker.WATCH_DIR_LIST
    monkeypatch.setattr(worker, "WATCH_DIR_LIST", [str(tmp_path)])
    monkeypatch.setattr(worker, "log", fake_log)

    try:
        worker.scan_once(queue=None, pending=set(), lock=None, reason="trigger")
    finally:
        worker.WATCH_DIR_LIST = original_dirs

    assert any(msg == "扫描未发现媒体" for _lvl, msg, _kw in logs)
