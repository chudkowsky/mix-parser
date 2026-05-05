import asyncio
import hashlib
import hmac
import math
import os
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import database
import steam as steam_client
from awards import generate_season_awards
from parser import parse_demo
from heatmap_match import generate_match_heatmap

ADMIN_PASSWORD  = os.environ.get("ADMIN_PASSWORD", "changeme")
STEAM_API_KEY   = os.environ.get("STEAM_API_KEY", "")


def _make_admin_token() -> str:
    """Deterministic token derived from the admin password — survives server restarts."""
    return hmac.new(ADMIN_PASSWORD.encode(), b"mix-parser-admin-v1", hashlib.sha256).hexdigest()


class LoginRequest(BaseModel):
    password: str


class CreateSeasonRequest(BaseModel):
    name: str
    start_date: str
    end_date: str | None = None


class CloseSeasonRequest(BaseModel):
    end_date: str | None = None


def require_admin(authorization: str | None = Header(default=None)):
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if not token or not hmac.compare_digest(token, _make_admin_token()):
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
DB_PATH     = BASE_DIR / "data/mix_parser.db"
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


async def _avatars(steamids: list[str]) -> dict:
    if not STEAM_API_KEY or not steamids:
        return {}
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, steam_client.get_avatars, DB_PATH, steamids, STEAM_API_KEY
    )


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
    return {"token": _make_admin_token()}


@app.post("/admin/logout")
async def admin_logout():
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
    background_tasks.add_task(generate_match_heatmap, match_id, DATA_DIR, FRONTEND)

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
    lb = database.get_leaderboard(conn)
    steamids = [p["steamid"] for p in lb["players"] + lb["guests"]]
    avatars = await _avatars(steamids)
    for p in lb["players"] + lb["guests"]:
        p["avatar"] = avatars.get(p["steamid"], {}).get("avatar")
    return JSONResponse(lb)


@app.get("/maps")
async def map_stats(conn: sqlite3.Connection = Depends(get_db)):
    return JSONResponse(database.get_map_stats(conn))


@app.get("/players")
async def list_players(conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute("""
        SELECT steamid, MAX(name) AS name, COUNT(DISTINCT match_id) AS matches_played,
               ROUND(SUM(rating * rounds_played) / SUM(rounds_played), 4) AS avg_rating
        FROM player_ratings
        GROUP BY steamid
        ORDER BY avg_rating DESC
    """).fetchall()
    players = [dict(r) for r in rows]
    steamids = [p["steamid"] for p in players]
    avatars = await _avatars(steamids)
    for p in players:
        p["avatarmedium"] = avatars.get(p["steamid"], {}).get("avatarmedium")
    return JSONResponse(players)


@app.get("/players/{steamid}")
async def player_profile(steamid: str, conn: sqlite3.Connection = Depends(get_db)):
    row = database.get_player_profile(conn, steamid)
    if row is None:
        raise HTTPException(404, "Player not found")
    avatars = await _avatars([steamid])
    row["avatarfull"] = avatars.get(steamid, {}).get("avatarfull")
    return JSONResponse(row)


# ── Seasons ───────────────────────────────────────────────────────────────────

@app.get("/seasons")
async def list_seasons(conn: sqlite3.Connection = Depends(get_db)):
    return JSONResponse(database.get_all_seasons(conn))


@app.get("/seasons/{season_id}/leaderboard")
async def season_leaderboard(season_id: int, conn: sqlite3.Connection = Depends(get_db)):
    result = database.get_season_leaderboard(conn, season_id)
    if result is None:
        raise HTTPException(404, "Season not found")
    players = result.get("players", [])
    steamids = [p["steamid"] for p in players]
    avatars = await _avatars(steamids)
    for p in players:
        p["avatar"] = avatars.get(p["steamid"], {}).get("avatar")
    return JSONResponse(_sanitize(result))


@app.get("/seasons/{season_id}/summary")
async def season_summary(season_id: int, conn: sqlite3.Connection = Depends(get_db)):
    season = database.get_season(conn, season_id)
    if not season:
        raise HTTPException(404, "Season not found")

    lb     = database.get_season_leaderboard(conn, season_id)
    titles = database.get_season_titles(conn, season_id)

    end = season["end_date"] or datetime.now(timezone.utc).isoformat()
    count_row = conn.execute(
        "SELECT COUNT(*) AS n FROM matches WHERE uploaded_at >= ? AND uploaded_at <= ?",
        (season["start_date"], end),
    ).fetchone()

    all_players = (lb["players"] if lb else []) + (lb["guests"] if lb else [])
    return JSONResponse(_sanitize({
        "season":      season,
        "top_players": all_players[:5],
        "awards":      titles,
        "stats": {
            "total_matches": count_row["n"] if count_row else 0,
            "total_players": len(all_players),
        },
    }))


@app.get("/titles")
async def all_titles(conn: sqlite3.Connection = Depends(get_db)):
    return JSONResponse(database.get_all_titles(conn))


@app.post("/admin/seasons")
async def create_season(
    body: CreateSeasonRequest,
    conn: sqlite3.Connection = Depends(get_db),
    _: None = Depends(require_admin),
):
    season_id = database.create_season(conn, body.name, body.start_date, body.end_date)
    return JSONResponse({"id": season_id, "name": body.name})


@app.post("/admin/seasons/{season_id}/close")
async def close_season(
    season_id: int,
    body: CloseSeasonRequest = CloseSeasonRequest(),
    conn: sqlite3.Connection = Depends(get_db),
    _: None = Depends(require_admin),
):
    season = database.get_season(conn, season_id)
    if not season:
        raise HTTPException(404, "Season not found")
    if not season["is_active"]:
        raise HTTPException(400, "Season is already closed")

    end_date = body.end_date or datetime.now(timezone.utc).isoformat()
    database.close_season(conn, season_id, end_date)

    lb          = database.get_season_leaderboard(conn, season_id)
    all_players = (lb["players"] if lb else []) + (lb["guests"] if lb else [])
    awards      = generate_season_awards(all_players, season_id)

    if awards:
        database.insert_player_titles(conn, awards)

    return JSONResponse({
        "closed":       True,
        "season_id":    season_id,
        "awards_given": len(awards),
        "awards": [
            {"type": a["award_type"], "label": a["award_label"], "steamid": a["steamid"]}
            for a in awards
        ],
    })


@app.delete("/admin/seasons/{season_id}")
async def delete_season(
    season_id: int,
    conn: sqlite3.Connection = Depends(get_db),
    _: None = Depends(require_admin),
):
    season = database.get_season(conn, season_id)
    if not season:
        raise HTTPException(404, "Season not found")
    if season["is_active"]:
        raise HTTPException(400, "Cannot delete an active season — close it first")

    database.delete_season(conn, season_id)
    return JSONResponse({"deleted": season_id})
