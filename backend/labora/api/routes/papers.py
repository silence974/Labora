from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_papers():
    # Placeholder — Task 3/4 will implement paper tools
    return {"papers": []}


@router.get("/{paper_id}")
async def get_paper(paper_id: str):
    return {"paper_id": paper_id, "status": "not_implemented"}
