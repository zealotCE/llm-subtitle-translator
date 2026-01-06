import os

import watcher.web as web


def test_find_subtitle_candidates(tmp_path, monkeypatch):
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    env_path = tmp_path / ".env"
    env_path.write_text(
        f"OUTPUT_TO_SOURCE_DIR=false\nOUT_DIR={out_dir}\nWATCH_DIRS={tmp_path}\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(web, "WEB_CONFIG_PATH", str(env_path))
    video_path = tmp_path / "sample.mp4"
    video_path.write_text("data", encoding="utf-8")
    srt_path = out_dir / "sample.srt"
    srt_path.write_text("1\n00:00:01,000 --> 00:00:02,000\nhi\n", encoding="utf-8")
    candidates = web.find_subtitle_candidates(str(video_path))
    assert str(srt_path) in candidates
    assert web.is_safe_path(str(srt_path)) is True
