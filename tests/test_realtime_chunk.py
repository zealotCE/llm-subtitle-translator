import wave

import watcher.worker as worker


def _write_silence(path, seconds=1.0, sample_rate=16000):
    frames = int(seconds * sample_rate)
    data = b"\x00\x00" * frames
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(data)


def test_split_wav_by_duration(tmp_path):
    wav_path = tmp_path / "test.wav"
    _write_silence(wav_path, seconds=1.0, sample_rate=16000)
    chunks = worker.split_wav_by_duration(
        str(wav_path), 0.4, str(tmp_path), overlap_ms=100
    )
    assert len(chunks) >= 2
    offsets = [offset for _path, offset in chunks]
    assert offsets[0] == 0
    assert offsets == sorted(offsets)
    for path, _offset in chunks:
        assert path


def test_choose_realtime_chunk_seconds(monkeypatch):
    monkeypatch.setattr(worker, "ASR_REALTIME_CHUNK_SECONDS", 0)
    monkeypatch.setattr(worker, "ASR_REALTIME_CHUNK_MIN_SECONDS", 300)
    monkeypatch.setattr(worker, "ASR_REALTIME_CHUNK_MAX_SECONDS", 900)
    monkeypatch.setattr(worker, "ASR_REALTIME_CHUNK_TARGET", 12)
    chunk = worker.choose_realtime_chunk_seconds(3600)
    assert 300 <= chunk <= 900
