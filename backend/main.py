import uvicorn
import argparse
import os


def main():
    parser = argparse.ArgumentParser(description="Labora Backend")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--project-dir", type=str, default=None)
    args = parser.parse_args()

    if args.project_dir:
        os.environ["LABORA_PROJECT_DIR"] = args.project_dir

    uvicorn.run(
        "labora.api:create_app",
        factory=True,
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
