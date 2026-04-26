"""
深度阅读 API 路由

提供论文深度阅读分析的 HTTP 接口
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import uuid
from datetime import datetime

# from labora.agent.paper_reader import PaperReader
from labora.memory.manager import MemoryManager
from labora.memory.short_term import InMemoryCache
from labora.memory.long_term import SQLiteMemory

router = APIRouter()

# 全局任务存储
deep_read_tasks: Dict[str, Dict[str, Any]] = {}

# 初始化记忆管理器
memory_manager = MemoryManager(
    short_term=InMemoryCache(),
    long_term=SQLiteMemory()
)


class StartDeepReadRequest(BaseModel):
    """启动深度阅读请求"""
    paper_title: str
    paper_url: Optional[str] = None
    paper_content: Optional[str] = None


class DeepReadStatusResponse(BaseModel):
    """深度阅读状态响应"""
    task_id: str
    status: str  # pending, running, completed, failed
    progress: int  # 进度百分比 0-100
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: str
    updated_at: str


class DeepReadResult(BaseModel):
    """深度阅读结果"""
    task_id: str
    paper_title: str
    summary: str
    key_points: List[str]
    key_quotes: List[Dict[str, str]]
    citations_count: int
    created_at: str


def run_deep_read_task(
    task_id: str,
    paper_title: str,
    paper_url: Optional[str],
    paper_content: Optional[str]
):
    """后台运行深度阅读任务"""
    try:
        # 更新状态为运行中
        deep_read_tasks[task_id]["status"] = "running"
        deep_read_tasks[task_id]["progress"] = 10
        deep_read_tasks[task_id]["updated_at"] = datetime.now().isoformat()

        # 模拟进度更新
        for progress in [20, 40, 60, 80]:
            deep_read_tasks[task_id]["progress"] = progress
            deep_read_tasks[task_id]["updated_at"] = datetime.now().isoformat()

        # 执行深度阅读分析
        # TODO: 实际调用论文阅读器进行分析
        result = {
            "paper_title": paper_title,
            "summary": (
                "本文提出了Transformer架构，完全基于注意力机制，"
                "摒弃了传统的循环和卷积结构。通过自注意力机制，"
                "模型能够捕获序列中的长距离依赖关系。"
            ),
            "key_points": [
                "Transformers通过自注意力机制实现全局依赖建模",
                "相比CNN的局部感受野，ViT在第一层就能捕获长距离依赖",
                "ViT需要更大的数据集进行有效训练"
            ],
            "key_quotes": [
                {
                    "text": (
                        "The self-attention mechanism allows the model "
                        "to capture long-range dependencies across "
                        "the entire image..."
                    ),
                    "section": "Section 1. Introduction"
                }
            ],
            "citations_count": 12
        }

        # 保存到长期记忆（使用 add_note 方法）
        try:
            memory_manager.long_term.add_note(
                paper_id=task_id,
                user_id="system",
                note={
                    "task_id": task_id,
                    "paper_title": paper_title,
                    "result": result,
                    "created_at": datetime.now().isoformat()
                }
            )
        except Exception as mem_error:
            # 记忆存储失败不影响主流程
            print(f"Failed to store in memory: {mem_error}")

        # 更新状态为完成
        deep_read_tasks[task_id]["status"] = "completed"
        deep_read_tasks[task_id]["progress"] = 100
        deep_read_tasks[task_id]["result"] = result
        deep_read_tasks[task_id]["updated_at"] = datetime.now().isoformat()

    except Exception as e:
        # 更新状态为失败
        deep_read_tasks[task_id]["status"] = "failed"
        deep_read_tasks[task_id]["error"] = str(e)
        deep_read_tasks[task_id]["updated_at"] = datetime.now().isoformat()


@router.post("/start", response_model=Dict[str, str])
async def start_deep_read(
    request: StartDeepReadRequest,
    background_tasks: BackgroundTasks
):
    """
    启动深度阅读任务

    Args:
        request: 包含论文信息的请求

    Returns:
        包含 task_id 的响应
    """
    # 生成任务 ID
    task_id = str(uuid.uuid4())

    # 初始化任务状态
    now = datetime.now().isoformat()
    deep_read_tasks[task_id] = {
        "task_id": task_id,
        "paper_title": request.paper_title,
        "status": "pending",
        "progress": 0,
        "result": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }

    # 在后台运行任务
    background_tasks.add_task(
        run_deep_read_task,
        task_id,
        request.paper_title,
        request.paper_url,
        request.paper_content
    )

    return {"task_id": task_id, "status": "pending"}


@router.get("/{task_id}/status", response_model=DeepReadStatusResponse)
async def get_deep_read_status(task_id: str):
    """
    获取深度阅读任务状态

    Args:
        task_id: 任务 ID

    Returns:
        任务状态信息
    """
    if task_id not in deep_read_tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    task = deep_read_tasks[task_id]
    return DeepReadStatusResponse(**task)


@router.get("/{task_id}/result")
async def get_deep_read_result(task_id: str):
    """
    获取深度阅读结果

    Args:
        task_id: 任务 ID

    Returns:
        深度阅读结果
    """
    if task_id not in deep_read_tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    task = deep_read_tasks[task_id]

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
async def list_deep_read_tasks():
    """
    列出所有深度阅读任务

    Returns:
        任务列表
    """
    return {
        "tasks": [
            {
                "task_id": task["task_id"],
                "paper_title": task["paper_title"],
                "status": task["status"],
                "progress": task["progress"],
                "created_at": task["created_at"],
            }
            for task in deep_read_tasks.values()
        ]
    }


@router.delete("/{task_id}")
async def delete_deep_read_task(task_id: str):
    """
    删除深度阅读任务

    Args:
        task_id: 任务 ID

    Returns:
        删除确认
    """
    if task_id not in deep_read_tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    del deep_read_tasks[task_id]
    return {"message": "Task deleted", "task_id": task_id}
