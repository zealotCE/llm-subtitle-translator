import srt
from datetime import timedelta

import watcher.worker as worker


def test_validate_and_fix_subs():
    subs = [
        srt.Subtitle(index=1, start=timedelta(seconds=2), end=timedelta(seconds=1), content="a"),
        srt.Subtitle(index=2, start=timedelta(seconds=1.5), end=timedelta(seconds=2), content="b"),
    ]
    fixed, issues = worker.validate_and_fix_subs(subs)
    assert issues
    assert fixed[0].start <= fixed[0].end
    assert fixed[1].start >= fixed[0].end
