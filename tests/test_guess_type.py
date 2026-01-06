import watcher.worker as worker


def test_guess_type_from_path():
    assert worker._guess_type_from_path("/media/show.S01E1149.mkv") == "tv"
    assert worker._guess_type_from_path("/media/show EP1149.mkv") == "tv"
    assert worker._guess_type_from_path("/media/movie.2024.mkv") == "movie"
