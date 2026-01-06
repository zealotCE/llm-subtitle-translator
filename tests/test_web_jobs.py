import os
import watcher.web as web


def test_job_db_and_status(tmp_path, monkeypatch):
    db_path = tmp_path / "web.db"
    monkeypatch.setattr(web, "WEB_DB_PATH", str(db_path))
    video_path = tmp_path / "sample.mp4"
    video_path.write_text("data", encoding="utf-8")

    job_id = web.create_job(str(video_path))
    jobs = web.list_jobs()
    assert any(job[0] == job_id for job in jobs)
    assert web.infer_job_status(str(video_path)) == "pending"

    done_path = tmp_path / "sample.done"
    done_path.write_text("done", encoding="utf-8")
    assert web.infer_job_status(str(video_path)) == "done"


def test_trigger_scan(tmp_path, monkeypatch):
    watch_dir = tmp_path / "watch"
    watch_dir.mkdir()
    monkeypatch.setattr(web, "WEB_TRIGGER_SCAN_FILE", ".scan_now")
    monkeypatch.setattr(web, "WEB_WATCH_DIRS", str(watch_dir))
    assert web.trigger_scan() is True
    assert (watch_dir / ".scan_now").exists()
