import asyncio
import hashlib
import math
import os
import secrets
import sqlite3
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import database
from parser import parse_demo

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "changeme")
_admin_tokens: set[str] = set()


class LoginRequest(BaseModel):
    password: str


def require_admin(authorization: str | None = Header(default=None)):
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if not token or token not in _admin_tokens:
        raise HTTPException(401, "Admin authentication required")


def _sanitize(obj):
    """Recursively replace NaN/Inf floats with None so JSON serialization never fails."""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj

BASE_DIR    = Path(__file__).parent
UPLOAD_DIR  = BASE_DIR.parent / "uploads"
DATA_DIR    = BASE_DIR / "data"
DB_PATH     = BASE_DIR / "mix_parser.db"
FRONTEND    = BASE_DIR.parent / "frontend"

UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="mix-parser", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")


@app.on_event("startup")
async def startup():
    database.init_db(DB_PATH, DATA_DIR)


# ── DB dependency ─────────────────────────────────────────────────────────────

def get_db():
    conn = database.get_connection(DB_PATH)
    try:
        yield conn
    finally:
        conn.close()


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return FileResponse(str(FRONTEND / "index.html"))


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/admin/login")
async def admin_login(body: LoginRequest):
    if not secrets.compare_digest(body.password, ADMIN_PASSWORD):
        raise HTTPException(403, "Invalid password")
    token = secrets.token_hex(32)
    _admin_tokens.add(token)
    return {"token": token}


@app.post("/admin/logout")
async def admin_logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        _admin_tokens.discard(authorization[7:])
    return {"ok": True}


@app.post("/parse")
async def parse(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    uploaded_by: str | None = Form(default=None),
    conn: sqlite3.Connection = Depends(get_db),
):
    name = file.filename or "upload.dem"
    if not any(name.endswith(ext) for ext in (".dem", ".dem.bz2", ".dem.gz", ".bz2")):
        raise HTTPException(400, "File must be a .dem, .dem.bz2, or .dem.gz")

    save_to = UPLOAD_DIR / f"{uuid.uuid4().hex}_{name}"
    sha = hashlib.sha256()
    with open(save_to, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            sha.update(chunk)
            f.write(chunk)
    file_hash = sha.hexdigest()

    # Duplicate check — return existing match without re-parsing
    existing = database.get_match_by_hash(conn, file_hash)
    if existing:
        background_tasks.add_task(save_to.unlink, True)
        full = database.load_match_data(DATA_DIR, existing["id"]) or {}
        ratings = database.get_match_with_ratings(conn, existing["id"])
        return JSONResponse(_sanitize({
            **full,
            **ratings,
            "already_parsed": True,
        }))

    try:
        loop   = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, parse_demo, save_to)
    except Exception as exc:
        save_to.unlink(missing_ok=True)
        raise HTTPException(500, f"Parse error: {exc}") from exc

    match_id = database.insert_match(conn, name, result, file_hash, uploaded_by)
    database.insert_player_ratings(conn, match_id, result["ratings"])
    conn.commit()
    database.save_match_data(DATA_DIR, match_id, result)

    background_tasks.add_task(save_to.unlink, True)

    return JSONResponse(_sanitize({"match_id": match_id, "already_parsed": False, **result}))


@app.get("/matches")
async def list_matches(conn: sqlite3.Connection = Depends(get_db)):
    return JSONResponse(database.get_all_matches(conn))


@app.get("/matches/{match_id}")
async def match_detail(match_id: int, conn: sqlite3.Connection = Depends(get_db)):
    row = database.get_match_with_ratings(conn, match_id)
    if row is None:
        raise HTTPException(404, "Match not found")

    full = database.load_match_data(DATA_DIR, match_id) or {}
    # Merge: DB ratings (authoritative) + disk payload (kills, rounds, etc.)
    return JSONResponse(_sanitize({
        **full,
        **row,  # DB fields overwrite (ratings from DB, not stale disk copy)
    }))


@app.delete("/matches/{match_id}")
async def delete_match(
    match_id: int,
    conn: sqlite3.Connection = Depends(get_db),
    _: None = Depends(require_admin),
):
    deleted = database.delete_match(conn, match_id, DATA_DIR)
    if not deleted:
        raise HTTPException(404, "Match not found")
    return JSONResponse({"deleted": match_id})


@app.get("/stats")
async def stats(conn: sqlite3.Connection = Depends(get_db)):
    return JSONResponse(database.get_stats(conn))


@app.get("/leaderboard")
async def leaderboard(conn: sqlite3.Connection = Depends(get_db)):
    return JSONResponse(database.get_leaderboard(conn))


@app.get("/players/{steamid}")
async def player_profile(steamid: str, conn: sqlite3.Connection = Depends(get_db)):
    row = database.get_player_profile(conn, steamid)
    if row is None:
        raise HTTPException(404, "Player not found")
    return JSONResponse(row)
