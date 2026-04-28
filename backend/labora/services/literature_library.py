from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from math import ceil
from typing import Any, Dict, List, Optional

from labora.core import config


class LiteratureLibrary:
    """Persist viewed and downloaded literature metadata for the UI."""

    def __init__(
        self,
        db_path: Optional[str] = None,
        download_dir: Optional[str] = None,
    ) -> None:
        self.db_path = db_path or config.db_path
        self.download_dir = Path(download_dir or Path(config.data_dir) / "papers")
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self.download_dir.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS literature_library (
                    paper_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    authors TEXT NOT NULL DEFAULT '[]',
                    year TEXT,
                    abstract TEXT,
                    source TEXT NOT NULL DEFAULT 'arXiv',
                    url TEXT,
                    pdf_url TEXT,
                    tags TEXT NOT NULL DEFAULT '[]',
                    local_path TEXT,
                    accessed_at TEXT,
                    downloaded_at TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    data TEXT NOT NULL DEFAULT '{}'
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_literature_accessed_at
                ON literature_library(accessed_at DESC, updated_at DESC)
                """
            )
            conn.commit()

    @staticmethod
    def normalize_paper_id(paper_id: str) -> str:
        return paper_id.replace("arxiv:", "").strip()

    @staticmethod
    def sanitize_filename(paper_id: str) -> str:
        normalized = LiteratureLibrary.normalize_paper_id(paper_id)
        return normalized.replace("/", "_").replace(":", "_")

    def resolve_download_path(self, paper_id: str) -> Path:
        safe_name = self.sanitize_filename(paper_id)
        return self.download_dir / f"{safe_name}.tar.gz"

    def get_paper(self, paper_id: str) -> Optional[Dict[str, Any]]:
        normalized_id = self.normalize_paper_id(paper_id)

        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT data FROM literature_library
                WHERE paper_id = ?
                """,
                (normalized_id,),
            ).fetchone()

        if not row:
            return None

        return json.loads(row["data"])

    def upsert_paper(
        self,
        paper: Dict[str, Any],
        *,
        mark_accessed: bool = False,
        mark_downloaded: bool = False,
        local_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized_id = self.normalize_paper_id(
            str(
                paper.get("paper_id")
                or paper.get("arxiv_id")
                or paper.get("id")
                or ""
            )
        )
        if not normalized_id:
            raise ValueError("Paper must contain a valid id")

        existing = self.get_paper(normalized_id) or {}
        merged = {**existing, **paper}
        merged["paper_id"] = normalized_id

        if merged.get("id") is None:
            merged["id"] = f"arxiv:{normalized_id}"

        authors = merged.get("authors") or []
        if not isinstance(authors, list):
            authors = [str(authors)]
        merged["authors"] = authors

        tags = merged.get("tags") or merged.get("categories") or []
        if not isinstance(tags, list):
            tags = [str(tags)]
        if merged.get("primary_category"):
            tags = [merged["primary_category"], *tags]
        merged["tags"] = list(dict.fromkeys([tag for tag in tags if tag]))[:5]

        if merged.get("year") is not None:
            merged["year"] = str(merged["year"])

        merged["source"] = merged.get("source") or "arXiv"
        merged["url"] = merged.get("url") or (
            f"https://arxiv.org/abs/{normalized_id}" if normalized_id else None
        )
        merged["source_url"] = merged.get("source_url") or (
            f"https://arxiv.org/e-print/{normalized_id}" if normalized_id else None
        )
        merged["pdf_url"] = merged.get("pdf_url") or (
            f"https://arxiv.org/pdf/{normalized_id}.pdf" if normalized_id else None
        )

        now = datetime.now(timezone.utc).isoformat()
        if mark_accessed:
            merged["accessed_at"] = now
        elif existing.get("accessed_at"):
            merged["accessed_at"] = existing["accessed_at"]

        if mark_downloaded:
            merged["downloaded_at"] = now
        elif existing.get("downloaded_at"):
            merged["downloaded_at"] = existing["downloaded_at"]

        if local_path:
            merged["local_path"] = local_path
        elif existing.get("local_path"):
            merged["local_path"] = existing["local_path"]

        title = merged.get("title") or existing.get("title") or normalized_id
        abstract = merged.get("abstract") or existing.get("abstract")

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO literature_library (
                    paper_id,
                    title,
                    authors,
                    year,
                    abstract,
                    source,
                    url,
                    pdf_url,
                    tags,
                    local_path,
                    accessed_at,
                    downloaded_at,
                    updated_at,
                    data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(paper_id) DO UPDATE SET
                    title = excluded.title,
                    authors = excluded.authors,
                    year = excluded.year,
                    abstract = excluded.abstract,
                    source = excluded.source,
                    url = excluded.url,
                    pdf_url = excluded.pdf_url,
                    tags = excluded.tags,
                    local_path = excluded.local_path,
                    accessed_at = excluded.accessed_at,
                    downloaded_at = excluded.downloaded_at,
                    updated_at = excluded.updated_at,
                    data = excluded.data
                """,
                (
                    normalized_id,
                    title,
                    json.dumps(authors),
                    merged.get("year"),
                    abstract,
                    merged["source"],
                    merged.get("url"),
                    merged.get("pdf_url"),
                    json.dumps(merged["tags"]),
                    merged.get("local_path"),
                    merged.get("accessed_at"),
                    merged.get("downloaded_at"),
                    now,
                    json.dumps(merged),
                ),
            )
            conn.commit()

        return merged

    def list_recent_papers(self, limit: int = 10) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT data FROM literature_library
                WHERE accessed_at IS NOT NULL
                ORDER BY accessed_at DESC, updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        return [json.loads(row["data"]) for row in rows]

    def search_papers(
        self,
        query: str,
        *,
        year: Optional[str] = None,
        source: Optional[str] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        result = self.search_papers_paginated(
            query=query,
            year=year,
            source=source,
            page=1,
            page_size=limit,
        )
        return result["items"]

    def search_papers_paginated(
        self,
        query: str,
        *,
        year: Optional[str] = None,
        source: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Dict[str, Any]:
        pattern = f"%{query.strip()}%"
        filters = [
            """
            (
                paper_id LIKE ?
                OR title LIKE ?
                OR abstract LIKE ?
                OR authors LIKE ?
                OR tags LIKE ?
            )
            """
        ]
        params: List[Any] = [pattern, pattern, pattern, pattern, pattern]

        if year:
            filters.append("year = ?")
            params.append(year)

        if source:
            filters.append("LOWER(source) = LOWER(?)")
            params.append(source)

        where_clause = " AND ".join(filters)
        offset = max(page - 1, 0) * page_size

        with self._connect() as conn:
            total_row = conn.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM literature_library
                WHERE {where_clause}
                """,
                params,
            ).fetchone()
            rows = conn.execute(
                f"""
                SELECT data FROM literature_library
                WHERE {where_clause}
                ORDER BY
                    COALESCE(downloaded_at, accessed_at, updated_at, created_at) DESC,
                    updated_at DESC
                LIMIT ? OFFSET ?
                """,
                [*params, page_size, offset],
            ).fetchall()

        total = int(total_row["total"]) if total_row else 0
        total_pages = ceil(total / page_size) if page_size > 0 else 0

        return {
            "items": [json.loads(row["data"]) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "has_prev": page > 1,
            "has_next": page < total_pages,
        }
