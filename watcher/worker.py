"""Compatibility wrapper for the worker implementation."""

if __name__ != "__main__":
    try:
        from .worker_impl import *  # type: ignore
    except ImportError:
        from worker_impl import *  # type: ignore

    __all__ = [name for name in globals() if not name.startswith("_")]
else:
    import runpy

    try:
        runpy.run_module("watcher.worker_impl", run_name="__main__")
    except ModuleNotFoundError:
        runpy.run_module("worker_impl", run_name="__main__")
