"""Exercise the packaged Node runtime with a backend on a runtime-selected port."""

import argparse
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import shutil
import subprocess
import tempfile
import threading
import time
import zipfile


class Backend(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/api/v1/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b'data: {"mode":"demo"}\n\n')
            self.wfile.flush()
            time.sleep(1)
            self.wfile.write(b'data: {"done":true}\n\n')
            return
        if self.path == "/api/v1/audio":
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("X-Audio-Sample-Rate", "24000")
            self.end_headers()
            self.wfile.write(b"\x01\x00" * 2400)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ok", "path": self.path}).encode())

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Set-Cookie", "lumi_session=test; Path=/; Secure; HttpOnly; SameSite=Lax")
        self.send_header("Set-Cookie", "second=test; Path=/; Secure")
        self.end_headers()
        self.wfile.write(json.dumps({
            "body": body.decode(), "cookie": self.headers.get("Cookie"),
            "origin": self.headers.get("Origin"), "csrf": self.headers.get("X-Lumi-Request"),
        }).encode())


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def check(archive=None, directory=None):
    backend = ThreadingHTTPServer(("127.0.0.1", 0), Backend)
    thread = threading.Thread(target=backend.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="botkeep-check-") as scratch:
            root = Path(scratch)
            if directory is not None:
                assert not any(path.name == ".env" for path in directory.rglob("*"))
                shutil.copytree(directory, root, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git"))
            else:
                with zipfile.ZipFile(archive) as bundle:
                    assert not any(name == ".env" or name.endswith("/.env") for name in bundle.namelist())
                    bundle.extractall(root)
            assert (root / "package.json").is_file()
            assert (root / "runtime/server.js").is_file()
            tracked_manifest = root / "runtime/.next/routes-manifest.json"
            original_manifest = tracked_manifest.read_bytes()
            port = free_port()
            (root / ".env").write_text(
                f"SERVER_PORT={port}\nPYTHON_API_URL=http://127.0.0.1:{backend.server_port}\n"
            )
            env = {key: value for key, value in os.environ.items() if key not in {
                "SERVER_PORT", "PYTHON_API_URL", "PORT", "NODE_ENV",
            }}
            # Reproduce a platform installing from the generated root lockfile.
            subprocess.run(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
                           cwd=root, env=env, check=True, stdout=subprocess.DEVNULL)
            with (root / "server.log").open("w+") as log:
                child = subprocess.Popen(["node", "--max-old-space-size=192", "start.cjs"],
                                         cwd=root, env=env, stdout=log, stderr=log)
                try:
                    deadline = time.monotonic() + 45
                    while True:
                        if child.poll() is not None or time.monotonic() > deadline:
                            log.seek(0)
                            raise AssertionError("Packaged frontend failed to start: " + log.read())
                        try:
                            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                            conn.request("GET", "/health")
                            response = conn.getresponse()
                            assert response.status == 200
                            assert json.loads(response.read())["path"] == "/health"
                            conn.close()
                            break
                        except OSError:
                            time.sleep(0.1)
                    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                    conn.request("GET", "/api/v1/probe?test=1")
                    response = conn.getresponse()
                    assert json.loads(response.read())["path"] == "/api/v1/probe?test=1"
                    raw = '{"text":"Xin chào"}'.encode()
                    conn.request("POST", "/api/v1/probe", body=raw, headers={
                        "Content-Type": "application/json", "Cookie": "lumi_session=existing",
                        "Origin": "https://frontend.example", "X-Lumi-Request": "1",
                    })
                    response = conn.getresponse()
                    assert len([v for k, v in response.getheaders() if k.lower() == "set-cookie"]) == 2
                    echoed = json.loads(response.read())
                    assert echoed == {
                        "body": raw.decode(), "cookie": "lumi_session=existing",
                        "origin": "https://frontend.example", "csrf": "1",
                    }
                    before = time.monotonic()
                    conn.request("GET", "/api/v1/events")
                    response = conn.getresponse()
                    assert response.status == 200
                    assert response.readline() == b'data: {"mode":"demo"}\n'
                    assert time.monotonic() - before < 0.8, "SSE was buffered"
                    assert b'"done":true' in response.read()
                    conn.request("GET", "/api/v1/audio")
                    response = conn.getresponse()
                    assert response.getheader("X-Audio-Sample-Rate") == "24000"
                    assert response.read() == b"\x01\x00" * 2400
                    asset = next((root / "runtime/.next/static").rglob("*.css"))
                    conn.request("GET", "/_next/static/" + asset.relative_to(root / "runtime/.next/static").as_posix())
                    response = conn.getresponse()
                    assert response.status == 200 and response.read()
                    conn.request("GET", "/", headers={"Cookie": "rb_guest=1"})
                    response = conn.getresponse()
                    assert response.status == 200 and "Bản demo" in response.read().decode()
                    assert tracked_manifest.read_bytes() == original_manifest, "Startup changed a Git-tracked file"
                    assert (root / ".botkeep-runtime/.next/routes-manifest.json").read_bytes() != original_manifest
                    conn.close()
                finally:
                    child.terminate()
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
            print("Botkeep frontend passed: runtime port/backend URL, root install, cookies, raw JSON, SSE, PCM, assets, demo UI.")
    finally:
        backend.shutdown()
        backend.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--zip", type=Path, default=Path("dist/botkeep/personax-botkeep-frontend.zip"))
    group.add_argument("--directory", type=Path)
    args = parser.parse_args()
    check(directory=args.directory.resolve()) if args.directory else check(args.zip.resolve())
