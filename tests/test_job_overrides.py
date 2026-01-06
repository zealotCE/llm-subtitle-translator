import watcher.worker as worker


def test_load_job_overrides(tmp_path):
    video = tmp_path / "sample.mkv"
    video.write_text("data", encoding="utf-8")
    meta = tmp_path / "sample.job.json"
    meta.write_text('{"asr_mode":"realtime","segment_mode":"auto"}', encoding="utf-8")
    data = worker.load_job_overrides(str(video))
    assert data.get("asr_mode") == "realtime"
