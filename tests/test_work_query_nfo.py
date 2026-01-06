import watcher.worker as worker


def test_build_work_query_with_nfo():
    work_info = worker.WorkInfo(title="旧标题", season="1", episode="1", confidence=0.2, source="path")
    nfo_info = {
        "title": "新标题",
        "original_title": "Original",
        "episode_title": "第1话",
        "season": 2,
        "episode": 10,
        "year": 2024,
        "type": "tv",
        "external_ids": {"tmdb": "123"},
    }
    query = worker._build_work_query(
        "/media/show.S01E01.mkv",
        work_info,
        subtitle_snippets={},
        language_priority=["ja-JP"],
        title_aliases=[],
        nfo_info=nfo_info,
        nfo_path="/media/show.nfo",
    )
    assert query.guessed_title == "新标题"
    assert query.guessed_season == 2
    assert query.guessed_episode == 10
    assert query.guessed_year == 2024
    assert query.guessed_type == "tv"
    assert query.nfo_path == "/media/show.nfo"
    assert query.nfo_original_title == "Original"
    assert query.external_ids["tmdb"] == "123"
