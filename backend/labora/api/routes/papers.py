"""
论文相关 API 路由

提供论文搜索、获取、阅读等接口
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uuid
from datetime import datetime

from labora.tools import arxiv_search, arxiv_get_paper
from labora.agent import read_paper
from labora.memory.manager import MemoryManager
from labora.memory.short_term import InMemoryCache
from labora.memory.long_term import SQLiteMemory

router = APIRouter()

# 初始化记忆管理器
memory_manager = MemoryManager(
    short_term=InMemoryCache(),
    long_term=SQLiteMemory()
)

# 论文阅读任务存储
reading_tasks: Dict[str, Dict[str, Any]] = {}


class SearchPapersRequest(BaseModel):
    """搜索论文请求"""
    query: str
    max_results: int = 10


class ReadPaperRequest(BaseModel):
    """阅读论文请求"""
    paper_id: str


def read_paper_task(task_id: str, paper_id: str):
    """后台运行论文阅读任务"""
    try:
        reading_tasks[task_id]["status"] = "running"
        reading_tasks[task_id]["updated_at"] = datetime.now().isoformat()

        # 运行论文阅读
        result = read_paper(paper_id, memory_manager)

        # 保存到记忆系统
        memory_manager.save_paper_analysis(
            paper_id=paper_id,
            analysis=result["key_information"],
            note=result["note"],
            user_id="default"
        )

        reading_tasks[task_id]["status"] = "completed"
        reading_tasks[task_id]["result"] = result
        reading_tasks[task_id]["updated_at"] = datetime.now().isoformat()

    except Exception as e:
        reading_tasks[task_id]["status"] = "failed"
        reading_tasks[task_id]["error"] = str(e)
        reading_tasks[task_id]["updated_at"] = datetime.now().isoformat()


@router.post("/search")
async def search_papers(request: SearchPapersRequest):
    """
    搜索论文

    Args:
        request: 包含查询词和结果数量的请求

    Returns:
        论文列表
    """
    try:
        papers = arxiv_search.invoke({
            "query": request.query,
            "max_results": request.max_results
        })
        return {"papers": papers, "count": len(papers)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{paper_id}")
async def get_paper_detail(paper_id: str):
    """
    获取论文详情

    Args:
        paper_id: 论文 ID（如 "arxiv:1706.03762" 或 "1706.03762"）

    Returns:
        论文详情
    """
    try:
        # 移除 arxiv: 前缀
        arxiv_id = paper_id.replace("arxiv:", "")

        # 先尝试从记忆系统获取
        cached_paper = memory_manager.get_paper(f"arxiv:{arxiv_id}")
        if cached_paper:
            return cached_paper

        # 从 ArXiv 获取
        paper = arxiv_get_paper.invoke({"arxiv_id": arxiv_id})
        if not paper:
            raise HTTPException(status_code=404, detail="Paper not found")

        return paper
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/read")
async def start_read_paper(
    request: ReadPaperRequest,
    background_tasks: BackgroundTasks
):
    """
    启动论文阅读任务

    Args:
        request: 包含论文 ID 的请求

    Returns:
        任务 ID
    """
    task_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    reading_tasks[task_id] = {
        "task_id": task_id,
        "paper_id": request.paper_id,
        "status": "pending",
        "result": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }

    background_tasks.add_task(read_paper_task, task_id, request.paper_id)

    return {"task_id": task_id, "status": "pending"}


@router.get("/read/{task_id}/status")
async def get_read_status(task_id: str):
    """
    获取论文阅读任务状态

    Args:
        task_id: 任务 ID

    Returns:
        任务状态
    """
    if task_id not in reading_tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    return reading_tasks[task_id]


@router.get("/read/{task_id}/result")
async def get_read_result(task_id: str):
    """
    获取论文阅读结果

    Args:
        task_id: 任务 ID

    Returns:
        阅读结果（key_information 和 note）
    """
    if task_id not in reading_tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    task = reading_tasks[task_id]

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


@router.get("/")
async def list_papers():
    """
    列出已保存的论文

    Returns:
        论文列表
    """
    # 这里可以从记忆系统获取已保存的论文
    # MVP 版本返回空列表
    return {"papers": []}
