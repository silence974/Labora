"""
深度阅读 API 路由

提供论文深度阅读分析的 HTTP 接口，支持三阶段渐进式分析：
  Stage 1 (0-30%):   核心理解 — TL;DR、研究问题、核心洞察、方法概述
  Stage 2 (35-65%):  深度分析 — 关键技术、实验发现、批判性阅读
  Stage 3 (70-100%): 学术脉络 — 前驱论文、后继论文、领域定位
"""

from datetime import datetime, timezone
from typing import Optional, Dict, Any
from pathlib import Path
import json
import sqlite3
import uuid
import logging

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from labora.core import config
from labora.agent.deep_reader import run_deep_reading

logger = logging.getLogger(__name__)

router = APIRouter()

# 全局任务存储
deep_read_tasks: Dict[str, Dict[str, Any]] = {}


# ── Request / Response Models ─────────────────────────────────────────────────────

class StartDeepReadRequest(BaseModel):
    """启动深度阅读请求"""
    paper_id: str
    paper_title: Optional[str] = None
    paper_content: Optional[str] = None


class DeepReadStatusResponse(BaseModel):
    """深度阅读状态响应"""
    task_id: str
    paper_id: str
    paper_title: str
    status: str  # pending, running, completed, failed
    progress: int  # 0-100
    current_stage: int  # 0 (未开始), 1, 2, 3
    stages: Optional[Dict[str, Any]] = None  # {"1": Stage1Result, "2": Stage2Result, ...}
    error: Optional[str] = None
    created_at: str
    updated_at: str


# ── Task Runner ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_paper_id(paper_id: str) -> str:
    return paper_id.replace("arxiv:", "").strip()


def _connect() -> sqlite3.Connection:
    Path(config.db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _init_deep_read_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS deep_read_results (
                paper_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                paper_title TEXT NOT NULL,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                current_stage INTEGER NOT NULL DEFAULT 0,
                stages TEXT NOT NULL DEFAULT '{}',
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_deep_read_results_updated_at
            ON deep_read_results(updated_at DESC)
            """
        )
        conn.commit()


def _row_to_result(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "task_id": row["task_id"],
        "paper_id": row["paper_id"],
        "paper_title": row["paper_title"],
        "status": row["status"],
        "progress": row["progress"],
        "current_stage": row["current_stage"],
        "stages": json.loads(row["stages"] or "{}"),
        "error": row["error"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _save_deep_read_result(task: Dict[str, Any]) -> None:
    paper_id = _normalize_paper_id(task.get("paper_id", ""))
    if not paper_id:
        return

    now = task.get("updated_at") or _now()
    created_at = task.get("created_at") or now

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO deep_read_results (
                paper_id,
                task_id,
                paper_title,
                status,
                progress,
                current_stage,
                stages,
                error,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(paper_id) DO UPDATE SET
                task_id = excluded.task_id,
                paper_title = excluded.paper_title,
                status = excluded.status,
                progress = excluded.progress,
                current_stage = excluded.current_stage,
                stages = excluded.stages,
                error = excluded.error,
                updated_at = excluded.updated_at
            """,
            (
                paper_id,
                task.get("task_id", ""),
                task.get("paper_title") or paper_id,
                task.get("status", "pending"),
                int(task.get("progress", 0)),
                int(task.get("current_stage", 0)),
                json.dumps(task.get("stages") or {}),
                task.get("error"),
                created_at,
                now,
            ),
        )
        conn.commit()


def _get_deep_read_by_paper(paper_id: str) -> Optional[Dict[str, Any]]:
    normalized_id = _normalize_paper_id(paper_id)
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM deep_read_results
            WHERE paper_id = ?
            """,
            (normalized_id,),
        ).fetchone()

    return _row_to_result(row) if row else None


def _get_deep_read_by_task(task_id: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM deep_read_results
            WHERE task_id = ?
            """,
            (task_id,),
        ).fetchone()

    return _row_to_result(row) if row else None


def _list_deep_read_results() -> list[Dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM deep_read_results
            ORDER BY updated_at DESC
            """
        ).fetchall()

    return [_row_to_result(row) for row in rows]


def _delete_deep_read_by_task(task_id: str) -> None:
    with _connect() as conn:
        conn.execute(
            """
            DELETE FROM deep_read_results
            WHERE task_id = ?
            """,
            (task_id,),
        )
        conn.commit()


_init_deep_read_db()


def run_deep_read_task(
    task_id: str,
    paper_id: str,
    paper_title: Optional[str],
    paper_content: Optional[str],
):
    """后台运行三阶段深度阅读任务"""
    try:
        deep_read_tasks[task_id].update({
            "status": "running",
            "progress": 0,
            "current_stage": 0,
            "updated_at": _now(),
        })
        _save_deep_read_result(deep_read_tasks[task_id])

        title = paper_title or paper_id
        content = paper_content or ""

        # 进度回调：将阶段结果写入任务状态
        def on_progress(progress: int, stage: int, stage_result):
            task = deep_read_tasks[task_id]
            if task.get("stages") is None:
                task["stages"] = {}
            if stage_result is not None:
                task["stages"][str(stage)] = (
                    stage_result.model_dump()
                    if hasattr(stage_result, "model_dump")
                    else stage_result
                )
            task["progress"] = progress
            task["current_stage"] = stage
            task["updated_at"] = _now()
            _save_deep_read_result(task)

        # 执行三阶段分析
        result = run_deep_reading(
            paper_id=paper_id,
            paper_text=content,
            paper_title=title,
            on_progress=on_progress,
        )

        # 标记完成
        deep_read_tasks[task_id].update({
            "status": "completed",
            "progress": 100,
            "current_stage": 3,
            "stages": result["stages"],
            "updated_at": _now(),
        })
        _save_deep_read_result(deep_read_tasks[task_id])

    except Exception as e:
        logger.error("Deep read task %s failed: %s", task_id, e)
        deep_read_tasks[task_id].update({
            "status": "failed",
            "error": str(e),
            "updated_at": _now(),
        })
        _save_deep_read_result(deep_read_tasks[task_id])


# ── Endpoints ────────────────────────────────────────────────────────────────────

@router.post("/start", response_model=Dict[str, str])
async def start_deep_read(
    request: StartDeepReadRequest,
    background_tasks: BackgroundTasks,
):
    """启动深度阅读任务"""
    task_id = str(uuid.uuid4())
    now = _now()

    deep_read_tasks[task_id] = {
        "task_id": task_id,
        "paper_id": _normalize_paper_id(request.paper_id),
        "paper_title": request.paper_title or _normalize_paper_id(request.paper_id),
        "status": "pending",
        "progress": 0,
        "current_stage": 0,
        "stages": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }
    _save_deep_read_result(deep_read_tasks[task_id])

    background_tasks.add_task(
        run_deep_read_task,
        task_id,
        request.paper_id,
        request.paper_title,
        request.paper_content,
    )

    return {"task_id": task_id, "status": "pending"}


@router.get("/{task_id}/status", response_model=DeepReadStatusResponse)
async def get_deep_read_status(task_id: str):
    """获取深度阅读任务状态（包含已完成的阶段结果）"""
    if task_id not in deep_read_tasks:
        stored_result = _get_deep_read_by_task(task_id)
        if not stored_result:
            raise HTTPException(status_code=404, detail="Task not found")
        return DeepReadStatusResponse(**stored_result)

    task = deep_read_tasks[task_id]
    return DeepReadStatusResponse(**task)


@router.get("/{task_id}/result")
async def get_deep_read_result(task_id: str):
    """获取深度阅读完整结果"""
    if task_id not in deep_read_tasks:
        stored_result = _get_deep_read_by_task(task_id)
        if not stored_result:
            raise HTTPException(status_code=404, detail="Task not found")
        task = stored_result
    else:
        task = deep_read_tasks[task_id]

    if task["status"] in ("pending", "running"):
        raise HTTPException(
            status_code=400,
            detail=f"Task is still {task['status']}",
        )

    if task["status"] == "failed":
        raise HTTPException(
            status_code=500,
            detail=task.get("error", "Task failed"),
        )

    return {
        "paper_title": task.get("paper_title"),
        "stages": task.get("stages"),
        "current_stage": task.get("current_stage"),
    }


@router.get("/")
async def list_deep_read_tasks():
    """列出所有深度阅读任务"""
    return {"tasks": _list_deep_read_results()}


@router.get("/paper/{paper_id:path}")
async def get_deep_read_by_paper(paper_id: str):
    """按论文 ID 获取已有深度阅读结果。"""
    result = _get_deep_read_by_paper(paper_id)
    if not result:
        raise HTTPException(status_code=404, detail="Deep read result not found")
    return result


@router.delete("/{task_id}")
async def delete_deep_read_task(task_id: str):
    """删除深度阅读任务"""
    stored_result = _get_deep_read_by_task(task_id)
    if task_id not in deep_read_tasks and not stored_result:
        raise HTTPException(status_code=404, detail="Task not found")

    if task_id in deep_read_tasks:
        del deep_read_tasks[task_id]
    _delete_deep_read_by_task(task_id)
    return {"message": "Task deleted", "task_id": task_id}
