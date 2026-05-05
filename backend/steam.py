import json
import sqlite3
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

STEAM_API_URL = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/"
CACHE_TTL_DAYS = 1


def _fetch_from_api(steamids: list[str], api_key: str) -> dict[str, dict]:
    result = {}
    for i in range(0, len(steamids), 100):
        batch = steamids[i : i + 100]
        url = f"{STEAM_API_URL}?key={api_key}&steamids={','.join(batch)}&format=json"
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                data = json.loads(resp.read())
            for player in data.get("response", {}).get("players", []):
                result[player["steamid"]] = {
                    "avatar":        player.get("avatar"),
                    "avatarmedium":  player.get("avatarmedium"),
                    "avatarfull":    player.get("avatarfull"),
                }
        except Exception:
            pass
    return result


def get_avatars(db_path: Path, steamids: list[str], api_key: str) -> dict[str, dict]:
    """Return avatar URLs for the given steamids, using DB cache + Steam API."""
    if not steamids:
        return {}

    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            f"SELECT steamid, avatar, avatarmedium, avatarfull, fetched_at "
            f"FROM player_avatars WHERE steamid IN ({','.join('?' * len(steamids))})",
            steamids,
        ).fetchall()
        cached = {r["steamid"]: dict(r) for r in rows}

        stale_cutoff = (datetime.now(timezone.utc) - timedelta(days=CACHE_TTL_DAYS)).isoformat()
        missing = [
            sid for sid in steamids
            if sid not in cached or (cached[sid].get("fetched_at") or "") < stale_cutoff
        ]

        if missing and api_key:
            fetched = _fetch_from_api(missing, api_key)
            if fetched:
                now = datetime.now(timezone.utc).isoformat()
                conn.executemany(
                    """INSERT INTO player_avatars (steamid, avatar, avatarmedium, avatarfull, fetched_at)
                       VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT(steamid) DO UPDATE SET
                           avatar=excluded.avatar, avatarmedium=excluded.avatarmedium,
                           avatarfull=excluded.avatarfull, fetched_at=excluded.fetched_at""",
                    [(sid, d.get("avatar"), d.get("avatarmedium"), d.get("avatarfull"), now)
                     for sid, d in fetched.items()],
                )
                conn.commit()
                cached.update(fetched)

        return cached
    finally:
        conn.close()
