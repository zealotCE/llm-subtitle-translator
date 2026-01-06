import watcher.web as web


def test_auth_token_roundtrip(monkeypatch):
    monkeypatch.setattr(web, "WEB_AUTH_USER", "admin")
    monkeypatch.setattr(web, "WEB_AUTH_SECRET", "secret")
    token = web.build_auth_token("admin")
    assert web.verify_auth_token(token) is True
