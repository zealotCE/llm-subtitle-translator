import watcher.worker as worker
import watcher.worker_impl as worker_impl


def test_worker_wrapper_reexports():
    assert worker is worker_impl
