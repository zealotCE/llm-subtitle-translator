import json

import watcher.web as web


class _DummyHandler(web.SettingsHandler):
    def __init__(self):
        self.headers = {}
        self._status = None
        self._headers = {}
        self._body = b""

    def send_response(self, code, message=None):  # noqa: ANN001
        self._status = code

    def send_header(self, key, value):  # noqa: ANN001
        self._headers[key] = value

    def end_headers(self):
        return None

    @property
    def wfile(self):
        class _W:
            def __init__(self, outer):
                self.outer = outer

            def write(self, data):
                self.outer._body += data

        return _W(self)


def test_export_json():
    handler = _DummyHandler()
    handler._send_json("logs", [{"a": 1}])
    data = json.loads(handler._body.decode("utf-8"))
    assert data[0]["a"] == 1
