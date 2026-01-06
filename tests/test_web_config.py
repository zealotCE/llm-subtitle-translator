import watcher.web as web


def test_env_parse_and_update(tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "# Sample\nKEY1=foo\nKEY2=\"bar baz\"\n",
        encoding="utf-8",
    )
    data, _entries = web.load_env_file(str(env_path))
    assert data["KEY1"] == "foo"
    assert data["KEY2"] == "bar baz"

    web.update_env_file(str(env_path), {"KEY1": "", "NEW_KEY": "hello world"})
    updated, _ = web.load_env_file(str(env_path))
    assert updated["KEY1"] == ""
    assert updated["NEW_KEY"] == "hello world"
