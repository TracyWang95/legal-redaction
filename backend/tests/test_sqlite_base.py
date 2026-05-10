from __future__ import annotations

import logging
import sqlite3

import pytest

from app.core import sqlite_base


def test_connect_sqlite_defaults_enable_wal_busy_timeout_and_row_factory(tmp_path):
    db_path = tmp_path / "default.sqlite3"

    conn = sqlite_base.connect_sqlite(str(db_path))
    try:
        journal_mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        busy_timeout = conn.execute("PRAGMA busy_timeout").fetchone()[0]
        conn.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)")
        conn.execute("INSERT INTO sample (value) VALUES ('ok')")
        row = conn.execute("SELECT id, value FROM sample").fetchone()

        assert journal_mode.lower() == "wal"
        assert busy_timeout == 5000
        assert isinstance(row, sqlite3.Row)
        assert row["value"] == "ok"
        assert row[0] == 1
    finally:
        conn.close()


def test_connect_sqlite_falls_back_when_wal_sidecars_cannot_be_opened(tmp_path, monkeypatch):
    db_path = tmp_path / "fallback.sqlite3"
    wal_attempts = 0

    class FakeConnection:
        row_factory = None

        def execute(self, sql: str, *args, **kwargs):
            nonlocal wal_attempts
            if sql == "PRAGMA journal_mode=WAL":
                wal_attempts += 1
                raise sqlite3.OperationalError("unable to open database file")
            return self

        def close(self):
            raise AssertionError("fallback should keep the connection open")

    def fail_open(*args, **kwargs):
        raise OSError("sidecar denied")

    monkeypatch.setattr(sqlite_base.sqlite3, "connect", lambda *args, **kwargs: FakeConnection())
    monkeypatch.setattr(sqlite_base, "open", fail_open, raising=False)

    conn = sqlite_base.connect_sqlite(str(db_path))

    assert isinstance(conn, FakeConnection)
    assert wal_attempts == 2


def test_connect_sqlite_skips_journal_switch_on_wsl_drvfs(monkeypatch):
    statements: list[str] = []

    class FakeUname:
        release = "5.15.167.4-microsoft-standard-WSL2"

    class FakeConnection:
        row_factory = None

        def execute(self, sql: str, *args, **kwargs):
            statements.append(sql)
            return self

    monkeypatch.setattr(sqlite_base.os, "name", "posix")
    monkeypatch.setattr(sqlite_base.os, "uname", lambda: FakeUname(), raising=False)
    monkeypatch.delenv("DATAINFRA_SQLITE_WAL_ON_DRVFS", raising=False)
    monkeypatch.setattr(
        sqlite_base.os.path,
        "realpath",
        lambda _path: "/mnt/d/ExampleProject/DataInfra-RedactionEverything/backend/data/file_store.sqlite3",
    )
    monkeypatch.setattr(sqlite_base.sqlite3, "connect", lambda *args, **kwargs: FakeConnection())

    conn = sqlite_base.connect_sqlite("/mnt/d/project/backend/data/file_store.sqlite3")

    assert isinstance(conn, FakeConnection)
    assert "PRAGMA journal_mode=WAL" not in statements
    assert "PRAGMA journal_mode=DELETE" in statements


def test_connect_sqlite_logs_wsl_drvfs_wal_skip_once_per_realpath(monkeypatch, caplog):
    statements: list[str] = []

    class FakeUname:
        release = "5.15.167.4-microsoft-standard-WSL2"

    class FakeConnection:
        row_factory = None

        def execute(self, sql: str, *args, **kwargs):
            statements.append(sql)
            return self

    db_path = "/mnt/d/ExampleProject/DataInfra-RedactionEverything/backend/data/jobs.sqlite3"
    monkeypatch.setattr(sqlite_base.os, "name", "posix")
    monkeypatch.setattr(sqlite_base.os, "uname", lambda: FakeUname(), raising=False)
    monkeypatch.delenv("DATAINFRA_SQLITE_WAL_ON_DRVFS", raising=False)
    monkeypatch.setattr(sqlite_base.os.path, "realpath", lambda _path: db_path)
    monkeypatch.setattr(sqlite_base.sqlite3, "connect", lambda *args, **kwargs: FakeConnection())
    monkeypatch.setattr(sqlite_base, "_wsl_drvfs_wal_disabled_logged_paths", set())

    with caplog.at_level(logging.INFO, logger=sqlite_base.logger.name):
        first_conn = sqlite_base.connect_sqlite(db_path)
        second_conn = sqlite_base.connect_sqlite(db_path)

    assert isinstance(first_conn, FakeConnection)
    assert isinstance(second_conn, FakeConnection)
    assert "PRAGMA journal_mode=WAL" not in statements
    assert statements.count("PRAGMA journal_mode=DELETE") == 2
    messages = [
        record.getMessage()
        for record in caplog.records
        if "SQLite WAL disabled by default for WSL drvfs database" in record.getMessage()
    ]
    assert messages == [
        (
            "SQLite WAL disabled by default for WSL drvfs database "
            f"{db_path}; set DATAINFRA_SQLITE_WAL_ON_DRVFS=1 to override"
        )
    ]


def test_connect_sqlite_can_force_wal_on_wsl_drvfs(monkeypatch):
    statements: list[str] = []

    class FakeUname:
        release = "5.15.167.4-microsoft-standard-WSL2"

    class FakeConnection:
        row_factory = None

        def execute(self, sql: str, *args, **kwargs):
            statements.append(sql)
            return self

    monkeypatch.setattr(sqlite_base.os, "name", "posix")
    monkeypatch.setattr(sqlite_base.os, "uname", lambda: FakeUname(), raising=False)
    monkeypatch.setenv("DATAINFRA_SQLITE_WAL_ON_DRVFS", "1")
    monkeypatch.setattr(
        sqlite_base.os.path,
        "realpath",
        lambda _path: "/mnt/d/ExampleProject/DataInfra-RedactionEverything/backend/data/file_store.sqlite3",
    )
    monkeypatch.setattr(sqlite_base.sqlite3, "connect", lambda *args, **kwargs: FakeConnection())

    conn = sqlite_base.connect_sqlite("/mnt/d/project/backend/data/file_store.sqlite3")

    assert isinstance(conn, FakeConnection)
    assert "PRAGMA journal_mode=WAL" in statements
    assert "PRAGMA journal_mode=DELETE" not in statements


def test_connect_sqlite_row_factory_false_returns_tuple_rows(tmp_path):
    db_path = tmp_path / "tuple_rows.sqlite3"

    conn = sqlite_base.connect_sqlite(str(db_path), row_factory=False)
    try:
        conn.execute("CREATE TABLE sample (value TEXT)")
        conn.execute("INSERT INTO sample (value) VALUES ('tuple')")
        row = conn.execute("SELECT value FROM sample").fetchone()

        assert isinstance(row, tuple)
        assert row[0] == "tuple"
        with pytest.raises(TypeError):
            row["value"]
    finally:
        conn.close()
