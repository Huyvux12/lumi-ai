from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def database(url: str):
    engine = create_async_engine(
        url, pool_pre_ping=True, **({"connect_args": {"timeout": 30}} if url.startswith("sqlite") else {})
    )
    if url.startswith("sqlite"):

        @event.listens_for(engine.sync_engine, "connect")
        def sqlite_pragmas(connection, _):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.close()
            connection.isolation_level = None

        @event.listens_for(engine.sync_engine, "begin")
        def sqlite_begin(connection):
            # Development SQLite serializes transactions; production uses row-level PostgreSQL locks.
            connection.exec_driver_sql("BEGIN IMMEDIATE")

    return engine, async_sessionmaker(engine, expire_on_commit=False)
