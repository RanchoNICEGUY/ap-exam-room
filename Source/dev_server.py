#!/usr/bin/env python3
"""Local HTTP server for AP Exam Room Portable & Playwright E2E testing."""
import http.server
import json
import mimetypes
import os
import re
import shutil
import socketserver
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Resolve optional local PDF vault from AP_EXAM_VAULT or ./Vault
VAULT_ROOT = HERE.parent.parent if (HERE.parent.parent / "计算机A").exists() else Path(os.environ.get("AP_EXAM_VAULT", str(HERE / "Vault")))
PDF_HELPER = HERE / "pdf_helper"
DATA_DIR = HERE / "Data"
SYNC_DB_DIR = Path.home() / "Library" / "Application Support" / "AP Exam Room"
SYNC_DB_PATH = SYNC_DB_DIR / "History.sqlite"
PDF_ENGINE = "helper" if (sys.platform == "darwin" and PDF_HELPER.is_file()) else "pdfjs"
HOST = "127.0.0.1"
PORT = 18990
for _arg in sys.argv[1:]:
    if _arg == "--lan":
        HOST = "0.0.0.0"
    elif _arg.startswith("--host="):
        HOST = _arg.split("=", 1)[1].strip() or HOST
    elif _arg.startswith("--pdf-engine="):
        _val = _arg.split("=", 1)[1].strip().lower()
        if _val in ("pdfjs", "helper"):
            PDF_ENGINE = _val
    elif _arg.isdigit():
        PORT = int(_arg)


def open_sync_db():
    SYNC_DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(SYNC_DB_PATH), timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=3000;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("CREATE TABLE IF NOT EXISTS attempts (exam TEXT, time INTEGER, payload TEXT NOT NULL, PRIMARY KEY(exam,time));")
    conn.execute("CREATE TABLE IF NOT EXISTS kv_sync (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);")
    conn.commit()
    return conn


def pull_sync_state(since_ms: int) -> dict:
    now_ms = int(time.time() * 1000)
    with open_sync_db() as conn:
        rows = conn.execute(
            "SELECT k, v, updated_at, deleted FROM kv_sync WHERE updated_at > ?",
            (since_ms,),
        ).fetchall()
        items = {
            k: {"v": v, "updatedAt": int(ts), "deleted": bool(deleted)}
            for (k, v, ts, deleted) in rows
        }
        attempts = []
        if since_ms <= 0:
            for (payload,) in conn.execute("SELECT payload FROM attempts ORDER BY time DESC").fetchall():
                try:
                    obj = json.loads(payload)
                    if isinstance(obj, dict):
                        attempts.append(obj)
                except Exception:
                    pass
    return {"serverTime": now_ms, "items": items, "attempts": attempts}


def push_sync_state(items: dict, history_rows=None) -> dict:
    now_ms = int(time.time() * 1000)
    conn = open_sync_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        for key, entry in (items or {}).items():
            if not isinstance(key, str) or not isinstance(entry, dict):
                continue
            val = str(entry.get("v") or "")
            try:
                incoming_ts = int(entry.get("updatedAt") or now_ms)
            except Exception:
                incoming_ts = now_ms
            deleted = 1 if entry.get("deleted") else 0
            cur = conn.execute("SELECT updated_at FROM kv_sync WHERE k = ?", (key,)).fetchone()
            existing_ts = int(cur[0]) if cur else -1
            if incoming_ts >= existing_ts:
                conn.execute(
                    "INSERT OR REPLACE INTO kv_sync(k, v, updated_at, deleted) VALUES(?,?,?,?)",
                    (key, val, incoming_ts, deleted),
                )
        for row in (history_rows or []):
            if not isinstance(row, dict):
                continue
            exam = row.get("examId")
            ts = row.get("time")
            if isinstance(exam, str) and isinstance(ts, (int, float)):
                conn.execute(
                    "INSERT OR REPLACE INTO attempts(exam, time, payload) VALUES(?,?,?)",
                    (exam, int(ts), json.dumps(row, ensure_ascii=False)),
                )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {"ok": True, "serverTime": int(time.time() * 1000)}


def safe_under(base: Path, rel: str):
    cleaned = urllib.parse.unquote(rel).lstrip("/")
    if ".." in Path(cleaned).parts:
        return None
    target = (base / cleaned).resolve()
    base_res = base.resolve()
    if target == base_res or str(target).startswith(str(base_res) + os.sep):
        return target
    return None


def serve_file_with_range(handler, file_path: Path, content_type: str):
    size = file_path.stat().st_size
    range_hdr = handler.headers.get("Range")
    if range_hdr:
        m = re.match(r"bytes=(\d*)-(\d*)", range_hdr.strip())
        if m:
            start = int(m.group(1)) if m.group(1) else 0
            end = int(m.group(2)) if m.group(2) else size - 1
            end = min(end, size - 1)
            if start > end or start >= size:
                handler.send_response(416)
                handler.send_header("Content-Range", f"bytes */{size}")
                handler.end_headers()
                return
            length = end - start + 1
            handler.send_response(206)
            handler.send_header("Content-Type", content_type)
            handler.send_header("Accept-Ranges", "bytes")
            handler.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            handler.send_header("Content-Length", str(length))
            handler.end_headers()
            with open(file_path, "rb") as f:
                f.seek(start)
                handler.wfile.write(f.read(length))
            return
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Accept-Ranges", "bytes")
    handler.send_header("Content-Length", str(size))
    handler.end_headers()
    with open(file_path, "rb") as f:
        shutil.copyfileobj(f, handler.wfile)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/manifest.json":
            mf = HERE / "manifest.json"
            if mf.is_file():
                body = mf.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "application/manifest+json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

        if path == "/sync/state":
            try:
                since = int((qs.get("since") or ["0"])[0] or "0")
            except Exception:
                since = 0
            body = json.dumps(pull_sync_state(since), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/server-info":
            info = json.dumps({
                "platform": sys.platform,
                "pdfEngine": PDF_ENGINE,
                "hasJava": bool(shutil.which("javac") and shutil.which("java")),
                "vaultFound": VAULT_ROOT.exists(),
                "vaultRoot": str(VAULT_ROOT),
                "syncEnabled": True,
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(info)))
            self.end_headers()
            self.wfile.write(info)
            return

        if path == "/pdf-raw":
            rel = (qs.get("path") or [""])[0]
            pdf = safe_under(VAULT_ROOT, rel)
            if not pdf or not pdf.is_file():
                self.send_error(404, f"PDF not found: {rel}")
                return
            serve_file_with_range(self, pdf, "application/pdf")
            return

        if path == "/open-pdf":
            rel = (qs.get("path") or [""])[0]
            pdf = safe_under(VAULT_ROOT, rel)
            if not pdf or not pdf.is_file():
                self.send_error(404, f"PDF not found: {rel}")
                return
            self.send_response(302)
            self.send_header("Location", "/pdf-raw?path=" + urllib.parse.quote(rel, safe=""))
            self.end_headers()
            return

        if path.startswith("/大陆统计_2026_视频/") or urllib.parse.unquote(path).startswith("/大陆统计_2026_视频/"):
            rel = urllib.parse.unquote(path).lstrip("/")
            vid = safe_under(VAULT_ROOT, "模考系统/" + rel)
            if not vid or not vid.is_file():
                self.send_error(404, f"Video not found: {rel}")
                return
            ctype = mimetypes.guess_type(str(vid))[0] or "video/mp4"
            serve_file_with_range(self, vid, ctype)
            return

        if path == "/pdf-info":
            if PDF_ENGINE == "pdfjs" or not PDF_HELPER.is_file():
                body = json.dumps({"error": "use_pdfjs"}).encode("utf-8")
                self.send_response(501)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            rel = (qs.get("path") or [""])[0]
            pdf = safe_under(VAULT_ROOT, rel)
            if not pdf or not pdf.exists():
                self.send_error(404, f"PDF not found: {rel}")
                return
            out = subprocess.check_output([str(PDF_HELPER), "info", str(pdf)])
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(out)
            return

        if path == "/pdf-page":
            if PDF_ENGINE == "pdfjs" or not PDF_HELPER.is_file():
                body = json.dumps({"error": "use_pdfjs"}).encode("utf-8")
                self.send_response(501)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            rel = (qs.get("path") or [""])[0]
            page = (qs.get("page") or ["1"])[0]
            scale = (qs.get("scale") or ["2.0"])[0]
            pdf = safe_under(VAULT_ROOT, rel)
            if not pdf or not pdf.exists():
                self.send_error(404, f"PDF not found: {rel}")
                return
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                tmp_path = tmp.name
            try:
                subprocess.run([str(PDF_HELPER), "page", str(pdf), str(page), str(scale), tmp_path], check=True)
                data = Path(tmp_path).read_bytes()
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/local-proxy":
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            target_url = payload.get("url", "")
            u = urllib.parse.urlparse(target_url)
            if u.hostname not in ("127.0.0.1", "localhost"):
                self.send_error(403, "Only localhost targets allowed")
                return
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            req = urllib.request.Request(
                target_url,
                data=(payload.get("body") or "").encode("utf-8"),
                method=payload.get("method", "POST"),
                headers={"Content-Type": "application/json", **(payload.get("headers") or {})},
            )
            try:
                with opener.open(req, timeout=15) as resp:
                    body = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return
        if parsed.path == "/sync/push":
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            res = push_sync_state(payload.get("items") or {}, payload.get("historyRows"))
            body = json.dumps(res, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/run-java":
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            raw_code = str(payload.get("code") or "")
            res = run_java_snippet(raw_code)
            body = json.dumps(res).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)


def run_java_snippet(raw_code: str) -> dict:
    trimmed = raw_code.strip()
    if not trimmed:
        return {"ok": False, "output": "Editor is empty. Enter Java statements, methods, or a class first."}
    tmp_dir = Path(tempfile.mkdtemp(prefix="apexam_java_"))
    try:
        class_name = "Main"
        file_stem = "Main"
        src = raw_code
        has_main = "static void main" in raw_code
        m_pub = re.search(r"public\s+class\s+([A-Za-z_]\w*)", raw_code)
        m_cls = re.search(r"\bclass\s+([A-Za-z_]\w*)", raw_code)
        if m_pub:
            class_name = file_stem = m_pub.group(1)
            if not has_main and "}" in raw_code:
                idx = raw_code.rfind("}")
                src = raw_code[:idx] + '\n    public static void main(String[] args) { System.out.println("Compiled successfully! (Add static void main or call your methods inside main to run tests.)"); }\n}\n'
                has_main = True
        elif m_cls:
            class_name = file_stem = m_cls.group(1)
            if not has_main:
                src = raw_code + '\nclass _Runner {\n    public static void main(String[] args) { System.out.println("Compiled successfully (0 syntax errors)."); }\n}\n'
                class_name = "_Runner"
                has_main = True
        elif re.search(r"(?:^|\n)\s*(?:public|private|static)\s+[\w<>\[\]]+\s+\w+\s*\(", raw_code):
            src = "import java.util.*;\npublic class Main {\n" + raw_code + '\n    public static void main(String[] args) { System.out.println("Method(s) compiled cleanly (0 syntax errors)."); }\n}\n'
            has_main = True
        else:
            src = "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n" + raw_code + "\n    }\n}\n"
            has_main = True

        src_file = tmp_dir / f"{file_stem}.java"
        src_file.write_text(src, encoding="utf-8")
        c = subprocess.run(["/usr/bin/javac", "-d", str(tmp_dir), str(src_file)], capture_output=True, text=True, timeout=8)
        if c.returncode != 0:
            return {"ok": False, "output": (c.stderr or c.stdout or "Compilation failed.").strip()}
        if not has_main:
            return {"ok": True, "output": "Compiled successfully (0 errors)."}
        r = subprocess.run(["/usr/bin/java", "-Xmx128m", "-cp", str(tmp_dir), class_name], capture_output=True, text=True, timeout=5)
        out = ((r.stdout or "") + (r.stderr or "")).strip()
        return {"ok": r.returncode == 0, "output": out or ("(Program finished with exit code 0 and no stdout.)" if r.returncode == 0 else f"Runtime error (exit {r.returncode}).")}
    except subprocess.TimeoutExpired:
        return {"ok": False, "output": "Execution timed out (limit: 5s)."}
    except Exception as e:
        return {"ok": False, "output": str(e)}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    print(f"Serving AP Exam Room on http://{HOST}:{PORT} (vault={VAULT_ROOT})", flush=True)
    ThreadingServer((HOST, PORT), Handler).serve_forever()
