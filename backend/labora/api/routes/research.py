"""
研究工作流 API 路由

提供研究工作流的 HTTP 接口
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, Dict, Any
import uuid
import asyncio
from datetime import datetime

from labora.agent import run_research
from labora.memory.manager import MemoryManager
from labora.memory.short_term import InMemoryCache
from labora.memory.long_term import SQLiteMemory

router = APIRouter()

# 全局任务存储（生产环境应使用 Redis 等持久化存储）
tasks: Dict[str, Dict[str, Any]] = {}

# 初始化记忆管理器
memory_manager = MemoryManager(
    short_term=InMemoryCache(),
    long_term=SQLiteMemory()
)


class StartResearchRequest(BaseModel):
    """启动研究请求"""
    research_question: str


class ResearchStatusResponse(BaseModel):
    """研究状态响应"""
    task_id: str
    status: str  # pending, running, completed, failed
    stage: Optional[str] = None  # 当前阶段
    progress: Optional[int] = None  # 进度百分比
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: str
    updated_at: str


def run_research_task(task_id: str, research_question: str):
    """后台运行研究任务"""
    try:
        # 更新状态为运行中
        tasks[task_id]["status"] = "running"
        tasks[task_id]["stage"] = "initial_explorer"
        tasks[task_id]["progress"] = 10
        tasks[task_id]["updated_at"] = datetime.now().isoformat()

        # 运行研究工作流
        result = run_research(
            research_question=research_question,
            memory_manager=memory_manager
        )

        # 更新状态为完成
        tasks[task_id]["status"] = "completed"
        tasks[task_id]["stage"] = "completed"
        tasks[task_id]["progress"] = 100
        tasks[task_id]["result"] = result
        tasks[task_id]["updated_at"] = datetime.now().isoformat()

    except Exception as e:
        # 更新状态为失败
        tasks[task_id]["status"] = "failed"
        tasks[task_id]["error"] = str(e)
        tasks[task_id]["updated_at"] = datetime.now().isoformat()


@router.post("/start", response_model=Dict[str, str])
async def start_research(
    request: StartResearchRequest,
    background_tasks: BackgroundTasks
):
    """
    启动研究工作流

    Args:
        request: 包含研究问题的请求

    Returns:
        包含 task_id 的响应
    """
    # 生成任务 ID
    task_id = str(uuid.uuid4())

    # 初始化任务状态
    now = datetime.now().isoformat()
    tasks[task_id] = {
        "task_id": task_id,
        "research_question": request.research_question,
        "status": "pending",
        "stage": None,
        "progress": 0,
        "result": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }

    # 在后台运行任务
    background_tasks.add_task(
        run_research_task,
        task_id,
        request.research_question
    )

    return {"task_id": task_id, "status": "pending"}


@router.get("/{task_id}/status", response_model=ResearchStatusResponse)
async def get_status(task_id: str):
    """
    获取研究任务状态

    Args:
        task_id: 任务 ID

    Returns:
        任务状态信息
    """
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    task = tasks[task_id]
    return ResearchStatusResponse(**task)


@router.get("/{task_id}/result")
async def get_result(task_id: str):
    """
    获取研究结果

    Args:
        task_id: 任务 ID

    Returns:
        研究结果（综述报告等）
    """
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    task = tasks[task_id]

    if task["status"] == "pending" or task["status"] == "running":
        raise HTTPException(
            status_code=400,
            detail=f"Task is still {task['status']}"
        )

    if task["status"] == "failed":
        raise HTTPException(
            status_code=500,
            detail=task.get("error", "Task failed")
        )

    return task["result"]


@router.delete("/{task_id}")
async def delete_task(task_id: str):
    """
    删除任务

    Args:
        task_id: 任务 ID

    Returns:
        删除确认
    """
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    del tasks[task_id]
    return {"message": "Task deleted", "task_id": task_id}


@router.get("/")
async def list_tasks():
    """
    列出所有任务

    Returns:
        任务列表
    """
    return {
        "tasks": [
            {
                "task_id": task["task_id"],
                "research_question": task["research_question"],
                "status": task["status"],
                "created_at": task["created_at"],
            }
            for task in tasks.values()
        ]
    }
