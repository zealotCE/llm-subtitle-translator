import os

import watcher.web as web


def test_scan_media(tmp_path, monkeypatch):
    media_dir = tmp_path / "media"
    media_dir.mkdir()
    video = media_dir / "a.mp4"
    video.write_text("data", encoding="utf-8")
    monkeypatch.setattr(web, "WEB_MEDIA_DIRS", str(media_dir))
    monkeypatch.setattr(web, "WEB_MEDIA_RECURSIVE", False)
    monkeypatch.setattr(web, "WEB_DB_PATH", str(tmp_path / "web.db"))
    count = web.scan_media()
    assert count == 1
    rows = web.list_media()
    assert rows and rows[0][0] == str(video)
