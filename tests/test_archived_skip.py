from pathlib import Path

import watcher.worker as worker


def test_should_skip_archived_marker(tmp_path, monkeypatch):
    video = tmp_path / "sample.mp4"
    video.write_text("x", encoding="utf-8")

    monkeypatch.setattr(worker, "OUTPUT_TO_SOURCE_DIR", True)
    monkeypatch.setattr(worker, "OUTPUT_LANG_SUFFIX", "")

    name = worker.base_name(str(video))
    out_dir = worker.output_dir_for(str(video))
    marker = worker.archived_marker_path(name, out_dir)
    Path(marker).write_text("archived", encoding="utf-8")

    skip, reason = worker.should_skip(str(video))
    assert skip is True
    assert reason == "archived"
