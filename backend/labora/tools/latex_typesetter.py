from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Sequence

from labora.tools.latex_parser import _extract_source_archive, _find_main_tex


LATEX_BUILD_TIMEOUT_SECONDS = 180


def _run_latexmk(command: Sequence[str], workdir: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=workdir,
        capture_output=True,
        text=True,
        timeout=LATEX_BUILD_TIMEOUT_SECONDS,
        check=False,
    )


def _format_compile_error(result: subprocess.CompletedProcess[str]) -> str:
    tail = "\n".join(
        line
        for line in (result.stdout + "\n" + result.stderr).splitlines()[-40:]
        if line.strip()
    )
    return tail or f"latexmk exited with code {result.returncode}"


def compile_latex_archive_to_pdf(archive_path: str | Path, output_pdf_path: str | Path) -> Path:
    """
    Compile a downloaded LaTeX source archive into a cached PDF preview.

    The output is deterministic per paper id and can be safely reused until the
    source archive changes.
    """
    archive = Path(archive_path)
    if not archive.exists():
        raise RuntimeError(f"Source archive not found: {archive}")

    output_pdf = Path(output_pdf_path)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)

    if output_pdf.exists() and output_pdf.stat().st_mtime >= archive.stat().st_mtime:
        return output_pdf

    with tempfile.TemporaryDirectory() as tmpdir:
        source_dir = Path(tmpdir) / "source"
        build_dir = Path(tmpdir) / "build"
        source_dir.mkdir(parents=True, exist_ok=True)
        build_dir.mkdir(parents=True, exist_ok=True)

        _extract_source_archive(archive, source_dir)
        main_tex = _find_main_tex(source_dir)

        commands = [
            [
                "latexmk",
                "-pdf",
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-file-line-error",
                f"-outdir={build_dir}",
                main_tex.name,
            ],
            [
                "latexmk",
                "-xelatex",
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-file-line-error",
                f"-outdir={build_dir}",
                main_tex.name,
            ],
        ]

        last_error: str | None = None
        for command in commands:
            try:
                result = _run_latexmk(command, main_tex.parent)
            except subprocess.TimeoutExpired as exc:
                last_error = f"Compilation timed out after {LATEX_BUILD_TIMEOUT_SECONDS}s"
                continue

            candidate = build_dir / f"{main_tex.stem}.pdf"
            if result.returncode == 0 and candidate.exists():
                shutil.copyfile(candidate, output_pdf)
                return output_pdf

            last_error = _format_compile_error(result)

        raise RuntimeError(last_error or "Failed to compile LaTeX source")
