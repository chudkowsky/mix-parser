#!/usr/bin/env python3
"""
Reassign a player in a specific match.
Usage:
  python remap_player.py <match_id> <old_steamid> <new_steamid> <new_name>

Example:
  python remap_player.py 5 76561198012345678 76561198087654321 ektor
"""

import sys
import gzip
import json
import sqlite3
from pathlib import Path

DB_PATH   = Path(__file__).parent / "data" / "mix_parser.db"
DATA_DIR  = Path(__file__).parent / "data"


def remap(match_id: int, old_steamid: str, new_steamid: str, new_name: str):
    # ── 1. Database ────────────────────────────────────────────────────────────
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        "SELECT * FROM player_ratings WHERE match_id=? AND steamid=?",
        (match_id, old_steamid)
    ).fetchall()

    if not rows:
        print(f"[DB] No player_ratings row found for steamid={old_steamid} in match {match_id}.")
        print("     Check the steamid — you can find it with:")
        print(f"     sqlite3 mix_parser.db \"SELECT steamid, name FROM player_ratings WHERE match_id={match_id};\"")
        conn.close()
        sys.exit(1)

    conn.execute(
        "UPDATE player_ratings SET steamid=?, name=? WHERE match_id=? AND steamid=?",
        (new_steamid, new_name, match_id, old_steamid)
    )
    conn.commit()
    conn.close()
    print(f"[DB] Updated player_ratings: {old_steamid} → {new_steamid} ({new_name})")

    # ── 2. JSON.gz file ────────────────────────────────────────────────────────
    gz_path = DATA_DIR / f"{match_id}.json.gz"
    if not gz_path.exists():
        print(f"[JSON] File {gz_path} not found — skipping.")
        return

    with gzip.open(gz_path, "rb") as f:
        data = json.loads(f.read())

    # ratings
    for r in data.get("ratings", []):
        if r.get("steamid") == old_steamid:
            r["steamid"] = new_steamid
            r["name"]    = new_name

    # kills — attacker, victim, assister
    for k in data.get("kills", []):
        for prefix in ("attacker", "user", "assister"):
            if k.get(f"{prefix}_steamid") == old_steamid:
                k[f"{prefix}_steamid"] = new_steamid
                k[f"{prefix}_name"]    = new_name

    with gzip.open(gz_path, "wb") as f:
        f.write(json.dumps(data).encode())

    print(f"[JSON] Updated {gz_path}")
    print("Done.")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(1)

    remap(
        match_id    = int(sys.argv[1]),
        old_steamid = sys.argv[2],
        new_steamid = sys.argv[3],
        new_name    = sys.argv[4],
    )
