from pathlib import Path
import yaml

import watcher.worker as worker


def test_load_title_aliases(tmp_path: Path):
    path = tmp_path / "aliases.yaml"
    path.write_text("""
海贼王:
  - 航海王
  - ONE PIECE
""", encoding="utf-8")
    data = worker.load_title_aliases(str(path))
    assert data["海贼王"] == ["航海王", "ONE PIECE"]


def test_resolve_title_aliases():
    alias_map = {
        "海贼王": ["航海王", "ONE PIECE"],
    }
    resolved = worker.resolve_title_aliases("航海王", alias_map)
    assert "海贼王" in resolved
    assert "ONE PIECE" in resolved


def test_slugify_title():
    assert worker._slugify_title("One Piece S01E1149") == "one_piece"
