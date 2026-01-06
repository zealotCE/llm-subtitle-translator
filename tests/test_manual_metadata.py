import json

import watcher.worker as worker


def test_load_manual_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "MANUAL_METADATA_DIR", "metadata")
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    video = tmp_path / "sample.mkv"
    video.write_text("data", encoding="utf-8")
    meta_dir = out_dir / "metadata"
    meta_dir.mkdir()
    meta_path = meta_dir / "sample.manual.json"
    meta_path.write_text(
        json.dumps(
            {
                "title_original": "示例",
                "title_localized": {"zh-CN": "示例剧"},
                "type": "tv",
                "year": 2024,
                "season": 1,
                "episode": 2,
                "episode_title": {"zh-CN": "第二话"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    meta = worker.load_manual_metadata(str(video), str(out_dir))
    assert meta is not None
    assert meta.title_original == "示例"
    assert meta.episode == 2
