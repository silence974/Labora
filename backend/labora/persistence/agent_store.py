"""
SQLite persistence for research agent tasks and document versions.

Tables:
  - agent_researches: research report containers
  - agent_tasks: task metadata (id, question, status, timestamps)
  - agent_document_versions: versioned document snapshots with rollback support
  - agent_state_snapshots: latest full agent state for page restoration
  - agent_nodes: node-first agent memory and UI timeline
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
                CREATE TABLE IF NOT EXISTS agent_researches (
                    research_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    research_question TEXT NOT NULL DEFAULT '',
                    document TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS agent_tasks (
                    task_id TEXT PRIMARY KEY,
                    research_id TEXT,
                    research_question TEXT NOT NULL,
                    initial_direction TEXT DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'running',
                    thread_id TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now')),
                    deleted_at TEXT,
                    FOREIGN KEY (research_id) REFERENCES agent_researches(research_id)
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

                CREATE TABLE IF NOT EXISTS agent_state_snapshots (
                    task_id TEXT PRIMARY KEY,
                    state_json TEXT NOT NULL,
                    updated_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (task_id) REFERENCES agent_tasks(task_id)
                );

                CREATE TABLE IF NOT EXISTS agent_nodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL UNIQUE,
                    task_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'completed',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (task_id) REFERENCES agent_tasks(task_id)
                );

                CREATE INDEX IF NOT EXISTS idx_agent_nodes_task
                    ON agent_nodes(task_id, id);
            """)
            self._ensure_column(conn, "agent_tasks", "research_id", "TEXT")
            self._ensure_column(conn, "agent_tasks", "deleted_at", "TEXT")
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_agent_tasks_research
                    ON agent_tasks(research_id, created_at)
                """
            )

    def _ensure_column(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        column_name: str,
        column_type: str,
    ) -> None:
        columns = {
            row["name"]
            for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        }
        if column_name not in columns:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}")

    # ── Task CRUD ──────────────────────────────────────────────────────────────

    def create_research(
        self,
        title: str,
        research_question: str = "",
        document: str = "",
    ) -> str:
        research_id = uuid.uuid4().hex[:12]
        normalized_title = title.strip() or research_question.strip() or "Untitled Research"
        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO agent_researches (
                    research_id, title, research_question, document, updated_at
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (research_id, normalized_title, research_question, document, _now()),
            )
        return research_id

    def get_research(self, research_id: str) -> Optional[dict]:
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM agent_researches WHERE research_id = ?",
                (research_id,),
            ).fetchone()
        if row is None:
            return None
        return dict(row)

    def list_researches(self) -> list[dict]:
        with self._get_conn() as conn:
            rows = conn.execute(
                """
                SELECT
                    r.*,
                    (
                        SELECT t.task_id
                        FROM agent_tasks t
                        WHERE t.research_id = r.research_id AND t.deleted_at IS NULL
                        ORDER BY t.created_at DESC
                        LIMIT 1
                    ) AS latest_task_id,
                    (
                        SELECT COUNT(*)
                        FROM agent_tasks t
                        WHERE t.research_id = r.research_id AND t.deleted_at IS NULL
                    ) AS session_count
                FROM agent_researches r
                WHERE r.status != 'deleted'
                ORDER BY r.updated_at DESC
                """
            ).fetchall()
        return [dict(r) for r in rows]

    def update_research_document(self, research_id: str, document: str) -> None:
        with self._get_conn() as conn:
            conn.execute(
                """
                UPDATE agent_researches
                SET document = ?, updated_at = ?
                WHERE research_id = ?
                """,
                (document, _now(), research_id),
            )

    def update_research_title(self, research_id: str, title: str) -> None:
        normalized_title = title.strip()
        if not normalized_title:
            return
        with self._get_conn() as conn:
            conn.execute(
                """
                UPDATE agent_researches
                SET title = ?, updated_at = ?
                WHERE research_id = ?
                """,
                (normalized_title, _now(), research_id),
            )

    def create_task(self, research_question: str, initial_direction: str = "",
                    thread_id: str = None, research_id: str = None) -> str:
        task_id = uuid.uuid4().hex[:12]
        if thread_id is None:
            thread_id = task_id
        if research_id is None:
            research_id = self.create_research(
                title=research_question,
                research_question=research_question,
            )
        with self._get_conn() as conn:
            conn.execute(
                "INSERT INTO agent_tasks (task_id, research_id, research_question, initial_direction, thread_id) "
                "VALUES (?, ?, ?, ?, ?)",
                (task_id, research_id, research_question, initial_direction, thread_id),
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
                "SELECT * FROM agent_tasks WHERE deleted_at IS NULL ORDER BY created_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def list_research_tasks(self, research_id: str) -> list[dict]:
        with self._get_conn() as conn:
            rows = conn.execute(
                """
                SELECT * FROM agent_tasks
                WHERE research_id = ? AND deleted_at IS NULL
                ORDER BY created_at DESC
                """,
                (research_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def clear_task_session(self, task_id: str) -> None:
        with self._get_conn() as conn:
            conn.execute("DELETE FROM agent_nodes WHERE task_id = ?", (task_id,))
            conn.execute("DELETE FROM agent_state_snapshots WHERE task_id = ?", (task_id,))
            conn.execute(
                "UPDATE agent_tasks SET status = ?, updated_at = ? WHERE task_id = ?",
                ("cleared", _now(), task_id),
            )

    def delete_task_session(self, task_id: str) -> None:
        with self._get_conn() as conn:
            conn.execute("DELETE FROM agent_nodes WHERE task_id = ?", (task_id,))
            conn.execute("DELETE FROM agent_state_snapshots WHERE task_id = ?", (task_id,))
            conn.execute(
                """
                UPDATE agent_tasks
                SET status = ?, deleted_at = ?, updated_at = ?
                WHERE task_id = ?
                """,
                ("deleted", _now(), _now(), task_id),
            )

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

    # ── State Snapshots ───────────────────────────────────────────────────────

    def save_state_snapshot(self, task_id: str, state: dict) -> None:
        state_json = json.dumps(state, ensure_ascii=False, default=str)
        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO agent_state_snapshots (task_id, state_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    state_json = excluded.state_json,
                    updated_at = excluded.updated_at
                """,
                (task_id, state_json, _now()),
            )

    def get_state_snapshot(self, task_id: str) -> Optional[dict]:
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT state_json FROM agent_state_snapshots WHERE task_id = ?",
                (task_id,),
            ).fetchone()
        if row is None:
            return None
        return json.loads(row["state_json"])

    # ── Agent Nodes ──────────────────────────────────────────────────────────

    def add_node(
        self,
        task_id: str,
        kind: str,
        title: str,
        status: str = "completed",
        payload: Optional[dict] = None,
        node_id: Optional[str] = None,
    ) -> dict:
        node_id = node_id or uuid.uuid4().hex
        payload_json = json.dumps(payload or {}, ensure_ascii=False, default=str)
        with self._get_conn() as conn:
            cursor = conn.execute(
                """
                INSERT INTO agent_nodes (
                    node_id, task_id, kind, title, status, payload_json, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (node_id, task_id, kind, title, status, payload_json, _now()),
            )
            row = conn.execute(
                """
                SELECT id, node_id, task_id, kind, title, status, payload_json, created_at, updated_at
                FROM agent_nodes
                WHERE id = ?
                """,
                (cursor.lastrowid,),
            ).fetchone()
        return self._node_row_to_dict(row)

    def get_nodes(self, task_id: str) -> list[dict]:
        with self._get_conn() as conn:
            rows = conn.execute(
                """
                SELECT id, node_id, task_id, kind, title, status, payload_json, created_at, updated_at
                FROM agent_nodes
                WHERE task_id = ?
                ORDER BY id ASC
                """,
                (task_id,),
            ).fetchall()
        return [self._node_row_to_dict(row) for row in rows]

    def _node_row_to_dict(self, row: sqlite3.Row) -> dict:
        return {
            "id": row["node_id"],
            "sequence": row["id"],
            "task_id": row["task_id"],
            "kind": row["kind"],
            "title": row["title"],
            "status": row["status"],
            "payload": json.loads(row["payload_json"] or "{}"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _step_kind(self, title: str) -> str:
        if (
            title in {
                "Run: reference deep read",
                "Run: deep read reference",
                "Run: deep read attached references",
                "Run: attach references",
            }
            or title.startswith("Run: reference deep read stage")
        ):
            return "deep_read"
        if title in {"Await Decision", "Await User Answer", "Await Confirmation", "Run: ask_user"}:
            return "conversation"
        return "thought"

    # ── Node convenience writers ─────────────────────────────────────────────

    def add_step_node(
        self,
        task_id: str,
        step: dict,
        *,
        kind: str = "thought",
    ) -> dict:
        title = step.get("label") or step.get("title") or "Agent Step"
        status = step.get("status") or "completed"
        node_kind = self._step_kind(str(title)) if kind == "thought" else kind
        return self.add_node(
            task_id,
            node_kind,
            title,
            status=status,
            payload={"step": step},
        )

    def add_message_node(
        self,
        task_id: str,
        role: str,
        content: str,
        actions: Optional[list[dict]] = None,
        references: Optional[list[dict]] = None,
    ) -> dict:
        message = {
            "id": uuid.uuid4().hex,
            "role": role,
            "content": content,
        }
        if actions:
            message["actions"] = actions
        if references:
            message["references"] = references
        title = (
            "User Input" if role == "user"
            else "Agent Response" if role == "assistant"
            else "System Message"
        )
        return self.add_node(
            task_id,
            "conversation",
            title,
            payload={"message": message},
        )
