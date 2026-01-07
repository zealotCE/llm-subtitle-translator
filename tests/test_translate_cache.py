import sqlite3

import watcher.worker as worker


def test_translate_cache_handles_sqlite_errors(tmp_path):
    cache = worker.TranslateCache(str(tmp_path / "cache.db"))

    class BrokenConn:
        def execute(self, *_args, **_kwargs):
            raise sqlite3.OperationalError("unable to open database file")

        def commit(self):
            raise sqlite3.OperationalError("unable to open database file")

    cache.conn = BrokenConn()
    cache.failed = False

    assert cache.get("k") is None
    cache.set("k", "v")
    assert cache.failed is True
