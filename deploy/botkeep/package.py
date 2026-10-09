"""Create portable Botkeep ZIPs from a Next standalone build and tracked backend files."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def write_zip(source, target):
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(source).as_posix())
    return sum(path.stat().st_size for path in source.rglob("*") if path.is_file())


def package(output):
    standalone = ROOT / ".next/standalone"
    if not (standalone / "server.js").exists():
        raise RuntimeError("Build with NEXT_OUTPUT_STANDALONE=1 before packaging")
    # Demo behavior is compiled into client bundles, so reject a production build.
    config = json.loads((ROOT / ".next/required-server-files.json").read_text())["config"]
    if config.get("env", {}).get("NEXT_PUBLIC_HOSTED_DEMO") != "true":
        raise RuntimeError("Build with NEXT_PUBLIC_HOSTED_DEMO=true before packaging")
    output.mkdir(parents=True, exist_ok=True)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
    with tempfile.TemporaryDirectory(prefix="botkeep-package-") as scratch:
        front = Path(scratch) / "frontend"
        runtime = front / "runtime"
        shutil.copytree(standalone, runtime)
        shutil.copytree(ROOT / ".next/static", runtime / ".next/static", dirs_exist_ok=True)
        shutil.copytree(ROOT / "public", runtime / "public", dirs_exist_ok=True)
        shutil.rmtree(runtime / ".next/cache", ignore_errors=True)
        shutil.copy2(ROOT / "deploy/botkeep/start.cjs", front / "start.cjs")
        (front / "package.json").write_text(json.dumps({
            "name": "personax-botkeep-runtime", "private": True,
            "engines": {"node": ">=24 <25"},
            "scripts": {"start": "node --max-old-space-size=192 start.cjs"},
        }, indent=2) + "\n")
        (front / "package-lock.json").write_text(json.dumps({
            "name": "personax-botkeep-runtime", "lockfileVersion": 3,
            "requires": True, "packages": {"": {
                "name": "personax-botkeep-runtime", "engines": {"node": ">=24 <25"},
            }},
        }, indent=2) + "\n")
        (front / ".gitignore").write_text("/.env\n/node_modules/\n/.botkeep-runtime/\n/runtime/.next/cache/\n*.log\n")
        (front / "BUILD.json").write_text(json.dumps({
            "source_branch": "Botkeep", "source_commit": commit,
            "runtime_branch": "botkeep-frontend", "next_version": "16.3.8",
        }, indent=2) + "\n")
        shutil.copy2(ROOT / "deploy/botkeep/frontend.env.example", front / ".env.example")
        shutil.copy2(ROOT / "deploy/botkeep/README.md", front / "README.md")
        backend = Path(scratch) / "backend"
        backend.mkdir()
        tracked = subprocess.check_output(["git", "ls-files", "-z", "backend"], cwd=ROOT).decode().split("\0")
        # Include new Botkeep files before their first commit as well.
        tracked += ["backend/botkeep_start.py", "backend/requirements.txt", "backend/constraints-botkeep.txt"]
        for name in sorted(set(tracked)):
            if not name or name.startswith("backend/tests/") or name in {
                "backend/.env.example", "backend/Dockerfile", "backend/.dockerignore",
            }:
                continue
            source = ROOT / name
            if source.is_file():
                target = backend / Path(name).relative_to("backend")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        shutil.copy2(ROOT / "deploy/botkeep/backend.env.example", backend / ".env.example")
        shutil.copy2(ROOT / "deploy/botkeep/README.md", backend / "README.md")
        sizes = {}
        for label, directory, limit in [("frontend", front, 768 * 1024**2), ("backend", backend, 96 * 1024**2)]:
            target = output / f"personax-botkeep-{label}.zip"
            uncompressed = write_zip(directory, target)
            if uncompressed > limit:
                target.unlink()
                raise RuntimeError(f"{label} exceeds its packaging budget")
            sizes[label] = {"uncompressed_bytes": uncompressed, "zip_bytes": target.stat().st_size}
        sizes["commit"] = commit
        (output / "sizes.json").write_text(json.dumps(sizes, indent=2) + "\n")
        shutil.copy2(ROOT / "deploy/botkeep/README.md", output / "README.md")
        print(json.dumps(sizes, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "dist/botkeep")
    package(parser.parse_args().output.resolve())
