import sqlite3
import json
from typing import Dict, List, Optional
from pathlib import Path
from labora.memory.interface import ILongTermMemory


class SQLiteMemory(ILongTermMemory):
    """基于 SQLite 的长期记忆实现"""

    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            from labora.core import config
            db_path = config.db_path
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        """初始化数据库表"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS papers (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    abstract TEXT,
                    authors TEXT,
                    year INTEGER,
                    arxiv_id TEXT,
                    data TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS reading_notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    paper_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    content TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (paper_id) REFERENCES papers(id)
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_papers_title
                ON papers(title)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_notes_paper
                ON reading_notes(paper_id, user_id)
            """)
            conn.commit()

    def add_paper(self, paper: Dict) -> str:
        paper_id = paper.get("id")
        if not paper_id:
            raise ValueError("Paper must have an 'id' field")

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO papers
                (id, title, abstract, authors, year, arxiv_id, data)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    paper_id,
                    paper.get("title", ""),
                    paper.get("abstract", ""),
                    json.dumps(paper.get("authors", [])),
                    paper.get("year"),
                    paper.get("arxiv_id"),
                    json.dumps(paper),
                ),
            )
            conn.commit()

        return paper_id

    def get_paper(self, paper_id: str) -> Optional[Dict]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                "SELECT * FROM papers WHERE id = ?", (paper_id,)
            )
            row = cursor.fetchone()

        if not row:
            return None

        return json.loads(row["data"])

    def search_papers(self, query: str, top_k: int = 10) -> List[Dict]:
        """简单的关键词搜索（标题和摘要）"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                SELECT * FROM papers
                WHERE title LIKE ? OR abstract LIKE ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (f"%{query}%", f"%{query}%", top_k),
            )
            rows = cursor.fetchall()

        return [json.loads(row["data"]) for row in rows]

    def add_note(self, paper_id: str, user_id: str, note: Dict) -> int:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO reading_notes (paper_id, user_id, content)
                VALUES (?, ?, ?)
                """,
                (paper_id, user_id, json.dumps(note)),
            )
            conn.commit()
            return cursor.lastrowid

    def get_notes(self, paper_id: str, user_id: str) -> List[Dict]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """
                SELECT * FROM reading_notes
                WHERE paper_id = ? AND user_id = ?
                ORDER BY created_at DESC
                """,
                (paper_id, user_id),
            )
            rows = cursor.fetchall()

        return [
            {
                "id": row["id"],
                "paper_id": row["paper_id"],
                "user_id": row["user_id"],
                "content": json.loads(row["content"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]
