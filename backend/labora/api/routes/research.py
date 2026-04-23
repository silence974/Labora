from fastapi import APIRouter

router = APIRouter()


@router.post("/start")
async def start_research(body: dict):
    # Placeholder — Task 6 will implement the full workflow
    return {"task_id": "placeholder", "status": "not_implemented"}


@router.get("/{task_id}/status")
async def get_status(task_id: str):
    return {"task_id": task_id, "status": "not_implemented"}


@router.post("/{task_id}/respond")
async def respond(task_id: str, body: dict):
    return {"task_id": task_id, "status": "not_implemented"}
