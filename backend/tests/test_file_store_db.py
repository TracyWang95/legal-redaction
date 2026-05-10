import sqlite3

from app.core import sqlite_base
from app.services.file_store_db import FileStoreDB


def test_file_store_db_precreates_wal_sidecars_when_drvfs_creation_fails(
    tmp_path,
    monkeypatch,
) -> None:
    wal_attempts = 0

    class FakeConnection:
        row_factory = None

        def execute(self, sql: str, *args, **kwargs):
            nonlocal wal_attempts
            if sql == "PRAGMA journal_mode=WAL":
                wal_attempts += 1
                if wal_attempts == 1:
                    raise sqlite3.OperationalError("unable to open database file")
            return self

        def executescript(self, _sql: str):
            return None

        def commit(self):
            return None

        def close(self):
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(sqlite_base.sqlite3, "connect", lambda *args, **kwargs: FakeConnection())

    db_path = tmp_path / "file_store.sqlite3"
    FileStoreDB(str(db_path))

    assert wal_attempts == 2
    assert (tmp_path / "file_store.sqlite3-wal").exists()
    assert (tmp_path / "file_store.sqlite3-shm").exists()


def test_file_store_db_retries_transient_open_failure(tmp_path, monkeypatch) -> None:
    store = FileStoreDB(str(tmp_path / "file_store.sqlite3"))
    original_connect = store._connect
    attempts = 0

    class FailingConnection:
        def execute(self, *_args, **_kwargs):
            raise sqlite3.OperationalError("unable to open database file")

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def flaky_connect():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return FailingConnection()
        return original_connect()

    monkeypatch.setattr(store, "_connect", flaky_connect)
    monkeypatch.setattr("app.services.file_store_db.time.sleep", lambda _delay: None)

    store.set("file-1", {"created_at": "2026-05-05T00:00:00Z", "value": 1})

    assert attempts == 2
    assert store.get("file-1")["value"] == 1


def test_file_store_db_retries_transient_init_failure(tmp_path, monkeypatch) -> None:
    attempts = 0

    class FailingConnection:
        row_factory = None

        def execute(self, *_args, **_kwargs):
            return self

        def executescript(self, _sql: str):
            raise sqlite3.OperationalError("disk I/O error")

        def commit(self):
            return None

        def close(self):
            return None

    original_connect = sqlite_base.sqlite3.connect

    def flaky_connect(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return FailingConnection()
        return original_connect(*args, **kwargs)

    monkeypatch.setattr(sqlite_base.sqlite3, "connect", flaky_connect)
    monkeypatch.setattr("app.services.file_store_db.time.sleep", lambda _delay: None)

    store = FileStoreDB(str(tmp_path / "file_store.sqlite3"))

    assert attempts >= 2
    store.set("file-1", {"created_at": "2026-05-05T00:00:00Z", "value": 1})
    assert store.get("file-1")["value"] == 1
