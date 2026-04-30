from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from labora.api.routes import health, research, papers, deep_read, literature


def create_app() -> FastAPI:
    app = FastAPI(title="Labora API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1):\d+",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(research.router, prefix="/api/research")
    app.include_router(papers.router, prefix="/api/papers")
    app.include_router(deep_read.router, prefix="/api/deep-read")
    app.include_router(literature.router, prefix="/api/literature")

    return app
