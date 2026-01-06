import watcher.worker as worker


def test_clean_title():
    name = "[Group] One.Piece.S01E1149.1080p.WEB-DL"
    cleaned = worker._clean_title(name)
    assert "One Piece" in cleaned
    assert "S01E1149" not in cleaned
    assert "1080p" not in cleaned
