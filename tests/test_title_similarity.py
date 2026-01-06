import watcher.worker as worker


def test_normalize_title_text():
    raw = "[Group] One.Piece S01E1149 第1149话"
    normalized = worker._normalize_title_text(raw)
    assert normalized == "one piece"


def test_title_similarity_basic():
    assert worker._title_similarity("One Piece", "one piece") > 0.9


def test_alias_bonus():
    bonus = worker._alias_bonus(["航海王"], "海贼王", "航海王")
    assert bonus == 0.2


def test_alias_match_score():
    score = worker._alias_match_score(["海贼王"], "海贼王剧场版")
    assert score >= 0.8
