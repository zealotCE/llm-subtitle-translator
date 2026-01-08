"""Compatibility wrapper for the worker implementation."""

if __name__ != "__main__":
    import importlib
    import sys

    try:
        _impl = importlib.import_module("watcher.worker_impl")
    except ImportError:
        _impl = importlib.import_module("worker_impl")

    sys.modules[__name__] = _impl
else:
    import runpy

    try:
        runpy.run_module("watcher.worker_impl", run_name="__main__")
    except ModuleNotFoundError:
        runpy.run_module("worker_impl", run_name="__main__")
