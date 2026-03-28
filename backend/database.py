import gzip
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def get_connection(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: Path, data_dir: Path) -> None:
    data_dir.mkdir(exist_ok=True)
    conn = get_connection(db_path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS matches (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            filename      TEXT    NOT NULL,
            file_hash     TEXT    UNIQUE,
            map_name      TEXT,
            server_name   TEXT,
            patch_version TEXT,
            ct_team_name  TEXT,
            t_team_name   TEXT,
            total_rounds  INTEGER,
            uploaded_at   TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS player_ratings (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id      INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
            steamid       TEXT    NOT NULL,
            name          TEXT,
            team          TEXT,
            rating        REAL,
            kast          REAL,
            kpr           REAL,
            dpr           REAL,
            apr           REAL,
            adr           REAL,
            impact        REAL,
            kills         INTEGER,
            deaths        INTEGER,
            assists       INTEGER,
            rounds_played INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_pr_match   ON player_ratings(match_id);
        CREATE INDEX IF NOT EXISTS idx_pr_steamid ON player_ratings(steamid);
    """)
    # Migrate existing DBs that predate the file_hash column
    existing = {r[1] for r in conn.execute("PRAGMA table_info(matches)")}
    if "file_hash" not in existing:
        conn.execute("ALTER TABLE matches ADD COLUMN file_hash TEXT")
    conn.commit()
    conn.close()


def get_match_by_hash(conn: sqlite3.Connection, file_hash: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM matches WHERE file_hash = ?", (file_hash,)
    ).fetchone()
    return dict(row) if row else None


def insert_match(conn: sqlite3.Connection, filename: str, parsed: dict, file_hash: str | None = None) -> int:
    header = parsed.get("header", {})
    rounds = parsed.get("rounds", [])
    ratings = parsed.get("ratings", [])

    ct_name = next((p["team"] for p in ratings if p.get("team") == "CT"), None)
    t_name  = next((p["team"] for p in ratings if p.get("team") == "TERRORIST"), None)

    # Some Valve demos expose team clan names in the header
    ct_team = header.get("team_clan_name_1") or header.get("team1_clan_name") or ct_name or "CT"
    t_team  = header.get("team_clan_name_2") or header.get("team2_clan_name") or t_name or "T"

    cur = conn.execute(
        """INSERT INTO matches
           (filename, file_hash, map_name, server_name, patch_version, ct_team_name, t_team_name, total_rounds, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            filename,
            file_hash,
            header.get("map_name"),
            header.get("server_name") or header.get("client_name"),
            header.get("patch_version") or header.get("demo_version_name"),
            ct_team,
            t_team,
            len(rounds),
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    return cur.lastrowid


def insert_player_ratings(conn: sqlite3.Connection, match_id: int, ratings: list) -> None:
    conn.executemany(
        """INSERT INTO player_ratings
           (match_id, steamid, name, team, rating, kast, kpr, dpr, apr, adr,
            impact, kills, deaths, assists, rounds_played)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                match_id,
                p["steamid"], p["name"], p["team"],
                p["rating"], p["kast"], p["kpr"], p["dpr"], p["apr"], p["adr"],
                p["impact"], p["kills"], p["deaths"], p["assists"], p["rounds"],
            )
            for p in ratings
        ],
    )


def save_match_data(data_dir: Path, match_id: int, parsed: dict) -> None:
    """Persist full parsed payload (kills, rounds, etc.) as compressed JSON."""
    path = data_dir / f"{match_id}.json.gz"
    blob = json.dumps(parsed, default=str).encode()
    with gzip.open(path, "wb") as f:
        f.write(blob)


def load_match_data(data_dir: Path, match_id: int) -> dict | None:
    path = data_dir / f"{match_id}.json.gz"
    if not path.exists():
        return None
    with gzip.open(path, "rb") as f:
        return json.loads(f.read())


def get_all_matches(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("""
        SELECT
            m.id, m.filename, m.map_name, m.server_name,
            m.ct_team_name, m.t_team_name, m.total_rounds, m.uploaded_at,
            pr.name   AS top_player_name,
            pr.rating AS top_player_rating,
            pr.team   AS top_player_team
        FROM matches m
        LEFT JOIN player_ratings pr
            ON pr.match_id = m.id
            AND pr.id = (
                SELECT id FROM player_ratings
                WHERE match_id = m.id
                ORDER BY rating DESC
                LIMIT 1
            )
        ORDER BY m.uploaded_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


def get_match_with_ratings(conn: sqlite3.Connection, match_id: int) -> dict | None:
    match_row = conn.execute(
        "SELECT * FROM matches WHERE id = ?", (match_id,)
    ).fetchone()
    if match_row is None:
        return None

    ratings = conn.execute(
        "SELECT * FROM player_ratings WHERE match_id = ? ORDER BY rating DESC",
        (match_id,),
    ).fetchall()

    return {**dict(match_row), "ratings": [dict(r) for r in ratings]}


def get_stats(conn: sqlite3.Connection) -> dict:
    """
    Returns data for dashboard charts:
    - player_history: per-match rating for each player, ordered chronologically
    - map_distribution: {map_name: match_count}
    """
    # Per-match, per-player ratings in chronological order
    rows = conn.execute("""
        SELECT
            m.id        AS match_id,
            m.map_name,
            m.uploaded_at,
            pr.steamid,
            pr.name,
            pr.team,
            pr.rating
        FROM matches m
        JOIN player_ratings pr ON pr.match_id = m.id
        ORDER BY m.uploaded_at ASC, pr.rating DESC
    """).fetchall()

    # Map distribution (count per map, one row per match not per player)
    map_rows = conn.execute("""
        SELECT map_name, COUNT(*) AS cnt
        FROM matches
        GROUP BY map_name
        ORDER BY cnt DESC
    """).fetchall()

    return {
        "player_history": [dict(r) for r in rows],
        "map_distribution": {r["map_name"]: r["cnt"] for r in map_rows},
    }


def delete_match(conn: sqlite3.Connection, match_id: int, data_dir: Path) -> bool:
    """Delete match + cascade player_ratings + remove json.gz. Returns False if not found."""
    row = conn.execute("SELECT id FROM matches WHERE id = ?", (match_id,)).fetchone()
    if row is None:
        return False
    conn.execute("DELETE FROM matches WHERE id = ?", (match_id,))
    conn.commit()
    blob = data_dir / f"{match_id}.json.gz"
    blob.unlink(missing_ok=True)
    return True


def get_leaderboard(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("""
        SELECT
            steamid,
            MAX(name) AS name,
            ROUND(SUM(rating * rounds_played) / SUM(rounds_played), 4) AS avg_rating,
            ROUND(SUM(adr  * rounds_played)   / SUM(rounds_played), 1) AS avg_adr,
            ROUND(SUM(kast * rounds_played)   / SUM(rounds_played), 1) AS avg_kast,
            ROUND(SUM(kpr  * rounds_played)   / SUM(rounds_played), 3) AS avg_kpr,
            ROUND(SUM(dpr  * rounds_played)   / SUM(rounds_played), 3) AS avg_dpr,
            SUM(kills)              AS total_kills,
            SUM(deaths)             AS total_deaths,
            SUM(assists)            AS total_assists,
            SUM(rounds_played)      AS total_rounds,
            COUNT(DISTINCT match_id) AS matches_played
        FROM player_ratings
        GROUP BY steamid
        ORDER BY avg_rating DESC
    """).fetchall()
    return [dict(r) for r in rows]
