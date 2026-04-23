from labora.api import create_app
import uvicorn
import argparse


def main():
    parser = argparse.ArgumentParser(description="Labora Backend")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    app = create_app()
    uvicorn.run(
        "labora.api:create_app",
        factory=True,
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
