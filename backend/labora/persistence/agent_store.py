"""
SQLite persistence for research agent tasks and document versions.

Tables:
  - agent_tasks: task metadata (id, question, status, timestamps)
  - agent_document_versions: versioned document snapshots with rollback support
"""

import sqlite3
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


class AgentStore:
    """CRUD operations for agent tasks and document version history."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_db(self):
        with self._get_conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS agent_tasks (
                    task_id TEXT PRIMARY KEY,
                    research_question TEXT NOT NULL,
                    initial_direction TEXT DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'running',
                    thread_id TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS agent_document_versions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    version_index INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    edit_type TEXT DEFAULT 'snapshot',
                    created_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (task_id) REFERENCES agent_tasks(task_id)
                );

                CREATE INDEX IF NOT EXISTS idx_agent_versions_task
                    ON agent_document_versions(task_id, version_index);
            """)

    # ── Task CRUD ──────────────────────────────────────────────────────────────

    def create_task(self, research_question: str, initial_direction: str = "",
                    thread_id: str = None) -> str:
        task_id = uuid.uuid4().hex[:12]
        if thread_id is None:
            thread_id = task_id
        with self._get_conn() as conn:
            conn.execute(
                "INSERT INTO agent_tasks (task_id, research_question, initial_direction, thread_id) "
                "VALUES (?, ?, ?, ?)",
                (task_id, research_question, initial_direction, thread_id),
            )
        return task_id

    def update_task(self, task_id: str, status: str):
        with self._get_conn() as conn:
            conn.execute(
                "UPDATE agent_tasks SET status = ?, updated_at = ? WHERE task_id = ?",
                (status, _now(), task_id),
            )

    def get_task(self, task_id: str) -> Optional[dict]:
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM agent_tasks WHERE task_id = ?", (task_id,)
            ).fetchone()
        if row is None:
            return None
        return dict(row)

    def list_tasks(self) -> list[dict]:
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM agent_tasks ORDER BY created_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    # ── Document Version CRUD ──────────────────────────────────────────────────

    def save_version(self, task_id: str, content: str, description: str = "",
                     edit_type: str = "snapshot") -> int:
        with self._get_conn() as conn:
            current_max = conn.execute(
                "SELECT COALESCE(MAX(version_index), -1) FROM agent_document_versions "
                "WHERE task_id = ?",
                (task_id,),
            ).fetchone()[0]
            next_index = current_max + 1
            conn.execute(
                "INSERT INTO agent_document_versions "
                "(task_id, version_index, content, description, edit_type) "
                "VALUES (?, ?, ?, ?, ?)",
                (task_id, next_index, content, description, edit_type),
            )
        return next_index

    def get_versions(self, task_id: str) -> list[dict]:
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM agent_document_versions WHERE task_id = ? "
                "ORDER BY version_index DESC",
                (task_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_version(self, task_id: str, version_index: int) -> Optional[dict]:
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM agent_document_versions "
                "WHERE task_id = ? AND version_index = ?",
                (task_id, version_index),
            ).fetchone()
        if row is None:
            return None
        return dict(row)

    def get_latest_version(self, task_id: str) -> Optional[dict]:
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM agent_document_versions WHERE task_id = ? "
                "ORDER BY version_index DESC LIMIT 1",
                (task_id,),
            ).fetchone()
        if row is None:
            return None
        return dict(row)

    def rollback_to_version(self, task_id: str, version_index: int) -> Optional[dict]:
        target = self.get_version(task_id, version_index)
        if target is None:
            return None
        # Create a new version that copies the target content
        new_index = self.save_version(
            task_id,
            target["content"],
            description=f"Rollback to version {version_index}",
            edit_type="rollback",
        )
        return self.get_version(task_id, new_index)
