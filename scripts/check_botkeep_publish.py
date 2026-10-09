"""Exercise Git publication against a disposable local remote, never GitHub."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "botkeep-frontend"


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def bundle(source, target, commit, obsolete=False):
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
        for entry in original.infolist():
            data = original.read(entry)
            if entry.filename == "BUILD.json":
                metadata = json.loads(data)
                metadata["source_commit"] = commit
                data = json.dumps(metadata).encode()
            output.writestr(entry, data)
        if obsolete:
            output.writestr("obsolete.txt", "Must disappear on the next deployment.\n")


def check():
    identity = dict(os.environ, GIT_AUTHOR_NAME="Botkeep test", GIT_AUTHOR_EMAIL="test@example.invalid",
                    GIT_COMMITTER_NAME="Botkeep test", GIT_COMMITTER_EMAIL="test@example.invalid")
    identity.pop("GITHUB_STEP_SUMMARY", None)
    with tempfile.TemporaryDirectory(prefix="botkeep-publish-test-") as scratch:
        scratch = Path(scratch)
        remote, source = scratch / "remote.git", scratch / "source"
        run("git", "init", "--bare", "--quiet", str(remote))
        run("git", "-C", str(ROOT), "push", str(remote), "HEAD:refs/heads/Botkeep")
        run("git", "--git-dir", str(remote), "symbolic-ref", "HEAD", "refs/heads/Botkeep")
        run("git", "clone", "--quiet", "--no-hardlinks", str(remote), str(source))
        original = run("git", "-C", str(source), "rev-parse", "HEAD")
        archive = ROOT / "dist/botkeep/personax-botkeep-frontend.zip"
        first = scratch / "first.zip"
        bundle(archive, first, original, obsolete=True)

        def publish(path):
            return run(sys.executable, str(ROOT / "deploy/botkeep/publish_frontend.py"),
                       "--repository", str(source), "--zip", str(path), env=identity)

        print(publish(first))
        head = run("git", "--git-dir", str(remote), "rev-parse", f"refs/heads/{BRANCH}")
        assert run("git", "--git-dir", str(remote), "rev-list", "--count", head) == "1"
        assert "already current" in publish(first)
        (source / "publish-test.txt").write_text("second source revision\n")
        run("git", "-C", str(source), "add", "publish-test.txt")
        run("git", "-C", str(source), "commit", "-m", "Second source revision", env=identity)
        second_source = run("git", "-C", str(source), "rev-parse", "HEAD")
        run("git", "-C", str(source), "push", "origin", "Botkeep")
        second = scratch / "second.zip"
        bundle(archive, second, second_source)
        print(publish(second))
        updated = run("git", "--git-dir", str(remote), "rev-parse", f"refs/heads/{BRANCH}")
        assert updated != head
        assert run("git", "--git-dir", str(remote), "rev-parse", f"{updated}^") == head
        # Clone exactly as a deployment platform would, including ignored runtime files.
        checkout = scratch / "deployed"
        run("git", "clone", "--quiet", "--depth=1", "--branch", BRANCH, remote.as_uri(), str(checkout))
        assert not (checkout / "obsolete.txt").exists()
        assert (checkout / "runtime/server.js").is_file()
        assert (checkout / "runtime/.next/routes-manifest.json").is_file()
        assert (checkout / "runtime/node_modules/next/package.json").is_file()
        assert not (checkout / ".env").exists()
        assert json.loads((checkout / "BUILD.json").read_text())["source_commit"] == second_source
        subprocess.run([sys.executable, str(ROOT / "scripts/check_botkeep_frontend.py"),
                        "--directory", str(checkout)], check=True, env=identity)
        mismatch = subprocess.run([sys.executable, str(ROOT / "deploy/botkeep/publish_frontend.py"),
                                   "--repository", str(source), "--zip", str(first)],
                                  text=True, capture_output=True, env=identity)
        assert mismatch.returncode != 0 and "does not match" in mismatch.stderr
        run("git", "-C", str(source), "checkout", "--detach", original)
        assert "Skipping superseded" in publish(first)
        assert run("git", "--git-dir", str(remote), "rev-parse", f"refs/heads/{BRANCH}") == updated
    print("Botkeep Git publish passed: first branch, repeat, fast-forward update, removed files, shallow clone, stale/mismatched build guards.")


if __name__ == "__main__":
    check()
