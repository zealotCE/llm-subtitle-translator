import watcher.worker as worker


def test_guess_variant_from_label():
    assert worker._guess_variant_from_label("movie.zh.srt") == "simplified"
    assert worker._guess_variant_from_label("movie.cht.srt") == "traditional"
    assert worker._guess_variant_from_label("CHS") == "simplified"
    assert worker._guess_variant_from_label("中文繁体") == "traditional"


def test_guess_variant_from_text_simplified():
    text = "这个国家很强大"  # includes simplified hint chars: 国, 这
    assert worker._guess_variant_from_text(text) == "simplified"


def test_guess_variant_from_text_traditional():
    text = "這個國家很強大"  # includes traditional chars: 這, 國
    assert worker._guess_variant_from_text(text) == "traditional"


def test_guess_variant_from_text_unknown_with_kana():
    text = "こんにちは世界"
    assert worker._guess_variant_from_text(text) == "unknown"


def test_describe_subtitle_variant_label_simplified_but_japanese(tmp_path):
    path = tmp_path / "movie.zh.srt"
    path.write_text("こんにちは世界", encoding="utf-8")
    info = {"kind": "external", "name": "movie.zh.srt", "path": str(path)}
    assert worker.describe_subtitle_variant(info) == "unknown"
