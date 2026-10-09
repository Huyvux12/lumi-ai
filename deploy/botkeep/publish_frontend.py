"""Publish a tested standalone snapshot as a normal, fast-forward GitHub branch."""

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BRANCH = "botkeep-frontend"


def git(repository, *args, **kwargs):
    return subprocess.check_output(["git", "-C", str(repository), *args], text=True, **kwargs).strip()


def latest_source(repository):
    result = git(repository, "ls-remote", "--exit-code", "origin", "refs/heads/Botkeep")
    return result.split()[0]


def publish(repository, archive):
    source_commit = git(repository, "rev-parse", "HEAD")
    with zipfile.ZipFile(archive) as bundle:
        metadata = json.loads(bundle.read("BUILD.json"))
        if metadata != {
            "source_branch": "Botkeep", "source_commit": source_commit,
            "runtime_branch": BRANCH, "next_version": "16.3.8",
        }:
            raise RuntimeError("Frontend artifact does not match the checked-out source commit")
        for entry in bundle.infolist():
            name = PurePosixPath(entry.filename)
            if name.is_absolute() or ".." in name.parts or any(
                part in {".git", ".env", ".venv", ".github"} for part in name.parts
            ):
                raise RuntimeError(f"Unexpected file in frontend artifact: {entry.filename}")
            if entry.file_size >= 100 * 1024**2:
                raise RuntimeError("Frontend contains a file too large for GitHub")
        if latest_source(repository) != source_commit:
            print("Skipping superseded source commit; the newer Botkeep run will publish.")
            return
        # --exit-code distinguishes a missing branch (2) from authentication/network errors.
        existing = subprocess.run(
            ["git", "-C", str(repository), "ls-remote", "--exit-code", "origin", f"refs/heads/{BRANCH}"],
            text=True, stdout=subprocess.PIPE, check=False,
        )
        if existing.returncode not in {0, 2}:
            raise RuntimeError("Cannot inspect the deployment branch")
        parent = None
        if existing.returncode == 0:
            git(repository, "fetch", "--depth=1", "origin", f"refs/heads/{BRANCH}")
            parent = git(repository, "rev-parse", "FETCH_HEAD")
            previous = json.loads(git(repository, "show", f"{parent}:BUILD.json"))
            if previous.get("runtime_branch") != BRANCH or previous.get("source_branch") != "Botkeep":
                raise RuntimeError("Refusing to modify a branch not generated for Botkeep")
        with tempfile.TemporaryDirectory(prefix="botkeep-publish-") as scratch:
            checkout = Path(scratch) / "frontend"
            git(repository, "worktree", "add", "--detach", "--no-checkout", str(checkout), parent or source_commit)
            try:
                git(checkout, "read-tree", "--empty")
                bundle.extractall(checkout)
                # Standalone dependencies are intentional generated runtime files, including dotfiles.
                git(checkout, "add", "--force", ".")
                tree = git(checkout, "write-tree")
                if parent and tree == git(repository, "rev-parse", f"{parent}^{{tree}}"):
                    print("Deployment snapshot is already current.")
                    return
                identity = dict(os.environ, GIT_AUTHOR_NAME="github-actions[bot]",
                                GIT_AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com",
                                GIT_COMMITTER_NAME="github-actions[bot]",
                                GIT_COMMITTER_EMAIL="41898282+github-actions[bot]@users.noreply.github.com")
                parents = ["-p", parent] if parent else []
                commit = git(checkout, "commit-tree", tree, *parents, "-m",
                             f"Deploy Botkeep frontend from {source_commit}", env=identity)
                # Verify the actual Git tree, so ignored .next/node_modules files cannot go missing.
                git(checkout, "reset", "--hard", commit)
                subprocess.run([sys.executable, str(ROOT / "scripts/check_botkeep_frontend.py"),
                                "--directory", str(checkout)], check=True)
                if latest_source(repository) != source_commit:
                    print("Skipping superseded build after Git snapshot checks.")
                    return
                # No force push: preserve deployment history and reject a concurrent update.
                git(repository, "push", "origin", f"{commit}:refs/heads/{BRANCH}")
                print(f"Published {BRANCH}: {commit} (source {source_commit})")
                summary = os.environ.get("GITHUB_STEP_SUMMARY")
                if summary:
                    with Path(summary).open("a") as stream:
                        stream.write(f"### Frontend ready for Botkeep\n\nBranch: `{BRANCH}`; root: `/`; start: `npm start`.\n\n"
                                     f"Source: `{source_commit}`; deployment: `{commit}`. No manual ZIP upload.\n")
            finally:
                git(repository, "worktree", "remove", "--force", str(checkout))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", type=Path, required=True)
    parser.add_argument("--repository", type=Path, default=ROOT)
    args = parser.parse_args()
    publish(args.repository.resolve(), args.zip.resolve())
