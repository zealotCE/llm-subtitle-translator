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
