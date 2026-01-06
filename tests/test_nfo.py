from pathlib import Path

import watcher.worker as worker


def test_parse_nfo_movie(tmp_path: Path):
    nfo = tmp_path / "movie.nfo"
    nfo.write_text(
        """
        <movie>
          <title>One Piece</title>
          <originaltitle>ワンピース</originaltitle>
          <year>2024</year>
          <uniqueid type="tmdb">123</uniqueid>
          <uniqueid type="imdb">tt9999999</uniqueid>
        </movie>
        """,
        encoding="utf-8",
    )
    info = worker._parse_nfo_file(str(nfo))
    assert info["type"] == "movie"
    assert info["title"] == "One Piece"
    assert info["original_title"] == "ワンピース"
    assert info["year"] == 2024
    assert info["external_ids"]["tmdb"] == "123"
    assert info["external_ids"]["imdb"] == "tt9999999"


def test_parse_nfo_episode(tmp_path: Path):
    nfo = tmp_path / "episode.nfo"
    nfo.write_text(
        """
        <episodedetails>
          <title>第1149话</title>
          <showtitle>海贼王</showtitle>
          <season>1</season>
          <episode>1149</episode>
          <firstaired>2025-01-01</firstaired>
        </episodedetails>
        """,
        encoding="utf-8",
    )
    info = worker._parse_nfo_file(str(nfo))
    assert info["type"] == "tv"
    assert info["title"] == "海贼王"
    assert info["episode_title"] == "第1149话"
    assert info["season"] == 1
    assert info["episode"] == 1149
    assert info["year"] == 2025


def test_load_nfo_info_same_name(tmp_path: Path):
    video = tmp_path / "One_Piece_1149.mkv"
    video.write_text("dummy", encoding="utf-8")
    nfo = tmp_path / "One_Piece_1149.nfo"
    nfo.write_text(
        """
        <movie>
          <title>One Piece</title>
        </movie>
        """,
        encoding="utf-8",
    )
    worker.NFO_ENABLED = True
    worker.NFO_SAME_NAME_ONLY = True
    info, path = worker.load_nfo_info(str(video))
    assert path == str(nfo)
    assert info["title"] == "One Piece"
