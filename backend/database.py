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
            ct_score      INTEGER,
            t_score       INTEGER,
            uploaded_at   TEXT    NOT NULL,
            uploaded_by   TEXT
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
            rounds_played INTEGER,
            hs_pct        REAL,
            survive_pct   REAL,
            opening_kills    INTEGER,
            opening_attempts INTEGER,
            ct_rating     REAL,
            ct_rounds     INTEGER,
            t_rating      REAL,
            t_rounds      INTEGER,
            flash_enemies INTEGER,
            flash_avg_dur REAL,
            clutch_won    INTEGER,
            clutch_total  INTEGER,
            multi_kills   TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_pr_match   ON player_ratings(match_id);
        CREATE INDEX IF NOT EXISTS idx_pr_steamid ON player_ratings(steamid);

        CREATE TABLE IF NOT EXISTS seasons (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            start_date  TEXT    NOT NULL,
            end_date    TEXT,
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS player_titles (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            season_id   INTEGER NOT NULL REFERENCES seasons(id),
            steamid     TEXT    NOT NULL,
            award_type  TEXT    NOT NULL,
            award_label TEXT    NOT NULL,
            flavor_text TEXT,
            stat_value  TEXT,
            earned_at   TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_pt_steamid ON player_titles(steamid);
        CREATE INDEX IF NOT EXISTS idx_pt_season  ON player_titles(season_id);

        CREATE TABLE IF NOT EXISTS player_avatars (
            steamid      TEXT PRIMARY KEY,
            avatar       TEXT,
            avatarmedium TEXT,
            avatarfull   TEXT,
            fetched_at   TEXT
        );

        CREATE TABLE IF NOT EXISTS lb_rank_snapshots (
            steamid   TEXT    NOT NULL,
            season_id INTEGER,
            rank      INTEGER NOT NULL,
            PRIMARY KEY (steamid, season_id)
        );
    """)
    # Migrate existing DBs — add any missing columns
    existing_matches = {r[1] for r in conn.execute("PRAGMA table_info(matches)")}
    if "file_hash" not in existing_matches:
        conn.execute("ALTER TABLE matches ADD COLUMN file_hash TEXT")
    if "uploaded_by" not in existing_matches:
        conn.execute("ALTER TABLE matches ADD COLUMN uploaded_by TEXT")
    if "ct_score" not in existing_matches:
        conn.execute("ALTER TABLE matches ADD COLUMN ct_score INTEGER")
    if "t_score" not in existing_matches:
        conn.execute("ALTER TABLE matches ADD COLUMN t_score INTEGER")
    if "duration_seconds" not in existing_matches:
        conn.execute("ALTER TABLE matches ADD COLUMN duration_seconds INTEGER")

    existing_pr = {r[1] for r in conn.execute("PRAGMA table_info(player_ratings)")}
    new_pr_cols = {
        "hs_pct":         "REAL",
        "survive_pct":    "REAL",
        "opening_kills":  "INTEGER",
        "opening_attempts": "INTEGER",
        "ct_rating":      "REAL",
        "ct_rounds":      "INTEGER",
        "t_rating":       "REAL",
        "t_rounds":       "INTEGER",
        "flash_enemies":  "INTEGER",
        "flash_avg_dur":  "REAL",
        "clutch_won":     "INTEGER",
        "clutch_total":   "INTEGER",
        "multi_kills":       "TEXT",
        "knife_kills":       "INTEGER",
        "zeus_kills":        "INTEGER",
        "clutch_breakdown":  "TEXT",
    }
    for col, typ in new_pr_cols.items():
        if col not in existing_pr:
            conn.execute(f"ALTER TABLE player_ratings ADD COLUMN {col} {typ}")

    conn.commit()
    conn.close()


def get_match_by_hash(conn: sqlite3.Connection, file_hash: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM matches WHERE file_hash = ?", (file_hash,)
    ).fetchone()
    return dict(row) if row else None


def insert_match(conn: sqlite3.Connection, filename: str, parsed: dict, file_hash: str | None = None, uploaded_by: str | None = None) -> int:
    header = parsed.get("header", {})
    rounds = parsed.get("rounds", [])
    ratings = parsed.get("ratings", [])

    ct_name = next((p["team"] for p in ratings if p.get("team") == "CT"), None)
    t_name  = next((p["team"] for p in ratings if p.get("team") == "TERRORIST"), None)

    # Some Valve demos expose team clan names in the header
    ct_team = header.get("team_clan_name_1") or header.get("team1_clan_name") or ct_name or "CT"
    t_team  = header.get("team_clan_name_2") or header.get("team2_clan_name") or t_name or "T"

    # Score: account for side swaps at halftime and OT halves (every 3 rounds after round 24)
    def _team_a_is_ct(rnd):
        if rnd <= 12: return True
        if rnd <= 24: return False
        return ((rnd - 25) // 3) % 2 == 1

    game_rounds = [r for r in rounds if (r.get("total_rounds_played") or 0) >= 1]
    ct_score = sum(
        1 for r in game_rounds
        if (_team_a_is_ct(r["total_rounds_played"]) and r.get("winner") == "CT") or
           (not _team_a_is_ct(r["total_rounds_played"]) and r.get("winner") == "T")
    )
    t_score = len(game_rounds) - ct_score

    cur = conn.execute(
        """INSERT INTO matches
           (filename, file_hash, map_name, server_name, patch_version, ct_team_name, t_team_name, total_rounds, ct_score, t_score, uploaded_at, uploaded_by, duration_seconds)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            filename,
            file_hash,
            header.get("map_name"),
            header.get("server_name") or header.get("client_name"),
            header.get("patch_version") or header.get("demo_version_name"),
            ct_team,
            t_team,
            len(game_rounds),
            ct_score or None,
            t_score  or None,
            datetime.now(timezone.utc).isoformat(),
            uploaded_by,
            parsed.get("duration_seconds"),
        ),
    )
    return cur.lastrowid


def insert_player_ratings(conn: sqlite3.Connection, match_id: int, ratings: list) -> None:
    conn.executemany(
        """INSERT INTO player_ratings
           (match_id, steamid, name, team, rating, kast, kpr, dpr, apr, adr,
            impact, kills, deaths, assists, rounds_played,
            hs_pct, survive_pct, opening_kills, opening_attempts,
            ct_rating, ct_rounds, t_rating, t_rounds,
            flash_enemies, flash_avg_dur, clutch_won, clutch_total,
            multi_kills, knife_kills, zeus_kills, clutch_breakdown)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        [
            (
                match_id,
                p["steamid"], p["name"], p["team"],
                p["rating"], p["kast"], p["kpr"], p["dpr"], p["apr"], p["adr"],
                p["impact"], p["kills"], p["deaths"], p["assists"], p["rounds"],
                p.get("hs_pct"), p.get("survive_pct"),
                p.get("opening_kills"), p.get("opening_attempts"),
                p.get("ct_rating"), p.get("ct_rounds"),
                p.get("t_rating"),  p.get("t_rounds"),
                p.get("flash_enemies"), p.get("flash_avg_dur"),
                p.get("clutch_won"), p.get("clutch_total"),
                json.dumps(p.get("multi_kills") or {}),
                p.get("knife_kills", 0), p.get("zeus_kills", 0),
                json.dumps(p.get("clutch_breakdown") or {}),
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
            m.ct_team_name, m.t_team_name, m.total_rounds, m.ct_score, m.t_score, m.uploaded_at, m.uploaded_by,
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
        """SELECT pr.*, pa.avatarmedium
           FROM player_ratings pr
           LEFT JOIN player_avatars pa ON pa.steamid = pr.steamid
           WHERE pr.match_id = ?
           ORDER BY pr.rating DESC""",
        (match_id,),
    ).fetchall()

    return {**dict(match_row), "ratings": [dict(r) for r in ratings]}


def get_player_profile(conn: sqlite3.Connection, steamid: str) -> dict | None:
    # Overall aggregated row
    agg = conn.execute("""
        SELECT
            pr.steamid, MAX(pr.name) AS name,
            ROUND(SUM(pr.rating * pr.rounds_played) / SUM(pr.rounds_played), 4) AS avg_rating,
            ROUND(SUM(pr.adr    * pr.rounds_played) / SUM(pr.rounds_played), 1) AS avg_adr,
            ROUND(SUM(pr.kast   * pr.rounds_played) / SUM(pr.rounds_played), 1) AS avg_kast,
            ROUND(SUM(pr.kpr    * pr.rounds_played) / SUM(pr.rounds_played), 3) AS avg_kpr,
            ROUND(SUM(pr.dpr    * pr.rounds_played) / SUM(pr.rounds_played), 3) AS avg_dpr,
            ROUND(SUM(pr.hs_pct * pr.rounds_played) / SUM(pr.rounds_played), 1) AS avg_hs_pct,
            ROUND(SUM(pr.survive_pct * pr.rounds_played) / SUM(pr.rounds_played), 1) AS avg_survive_pct,
            SUM(pr.kills)            AS total_kills,
            SUM(pr.deaths)           AS total_deaths,
            SUM(pr.assists)          AS total_assists,
            SUM(pr.rounds_played)    AS total_rounds,
            SUM(pr.opening_kills)    AS total_opening_kills,
            SUM(pr.opening_attempts) AS total_opening_attempts,
            SUM(pr.flash_enemies)    AS total_flash_enemies,
            ROUND(SUM(pr.flash_avg_dur * pr.flash_enemies) / NULLIF(SUM(pr.flash_enemies), 0), 2) AS avg_flash_dur,
            SUM(pr.clutch_won)       AS total_clutch_won,
            SUM(pr.clutch_total)     AS total_clutch_total,
            SUM(pr.knife_kills)      AS total_knife_kills,
            SUM(pr.zeus_kills)       AS total_zeus_kills,
            COUNT(DISTINCT pr.match_id) AS matches_played
        FROM player_ratings pr
        WHERE pr.steamid = ?
    """, (steamid,)).fetchone()

    if agg is None or agg["name"] is None:
        return None

    # Per-match rows
    matches = conn.execute("""
        SELECT
            m.id AS match_id, m.map_name, m.uploaded_at,
            pr.rating, pr.kills, pr.deaths, pr.assists,
            pr.adr, pr.kast, pr.hs_pct, pr.survive_pct,
            pr.opening_kills, pr.opening_attempts,
            pr.ct_rating, pr.ct_rounds, pr.t_rating, pr.t_rounds,
            pr.flash_enemies, pr.flash_avg_dur,
            pr.clutch_won, pr.clutch_total,
            pr.multi_kills, pr.knife_kills, pr.zeus_kills,
            pr.rounds_played, pr.team
        FROM matches m
        JOIN player_ratings pr ON pr.match_id = m.id
        WHERE pr.steamid = ?
        ORDER BY m.uploaded_at ASC
    """, (steamid,)).fetchall()

    # Per-map aggregated stats
    map_stats = conn.execute("""
        SELECT
            m.map_name,
            COUNT(*) AS matches,
            ROUND(SUM(pr.rating * pr.rounds_played) / SUM(pr.rounds_played), 4) AS avg_rating,
            ROUND(SUM(pr.adr    * pr.rounds_played) / SUM(pr.rounds_played), 1) AS avg_adr,
            ROUND(SUM(pr.kast   * pr.rounds_played) / SUM(pr.rounds_played), 1) AS avg_kast,
            ROUND(SUM(pr.hs_pct * pr.rounds_played) / SUM(pr.rounds_played), 1) AS avg_hs_pct,
            SUM(pr.kills)  AS total_kills,
            SUM(pr.deaths) AS total_deaths,
            SUM(pr.flash_enemies) AS total_flash_enemies
        FROM matches m
        JOIN player_ratings pr ON pr.match_id = m.id
        WHERE pr.steamid = ?
        GROUP BY m.map_name
        ORDER BY avg_rating DESC
    """, (steamid,)).fetchall()

    return {
        **dict(agg),
        "matches":   [dict(r) for r in matches],
        "map_stats": [dict(r) for r in map_stats],
    }


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


def get_map_stats(conn: sqlite3.Connection) -> list:
    maps = conn.execute("""
        SELECT
            map_name,
            COUNT(*)          AS games_played,
            SUM(total_rounds) AS total_rounds,
            ROUND(AVG(CAST(ct_score AS FLOAT) / NULLIF(total_rounds, 0) * 100), 1) AS ct_round_pct,
            ROUND(AVG(CAST(t_score  AS FLOAT) / NULLIF(total_rounds, 0) * 100), 1) AS t_round_pct
        FROM matches
        WHERE map_name IS NOT NULL
        GROUP BY map_name
        ORDER BY games_played DESC
    """).fetchall()

    result = []
    for row in maps:
        map_name = row["map_name"]

        king = conn.execute("""
            SELECT pr.name, pr.steamid,
                   ROUND(SUM(pr.rating * pr.rounds_played) / SUM(pr.rounds_played), 4) AS avg_rating,
                   COUNT(DISTINCT pr.match_id) AS matches_on_map
            FROM player_ratings pr
            JOIN matches m ON m.id = pr.match_id
            WHERE m.map_name = ?
            GROUP BY pr.steamid
            HAVING COUNT(DISTINCT pr.match_id) >= 2
            ORDER BY avg_rating DESC
            LIMIT 1
        """, (map_name,)).fetchone()

        most_played = conn.execute("""
            SELECT pr.name, pr.steamid, COUNT(DISTINCT pr.match_id) AS matches_on_map
            FROM player_ratings pr
            JOIN matches m ON m.id = pr.match_id
            WHERE m.map_name = ?
            GROUP BY pr.steamid
            ORDER BY matches_on_map DESC
            LIMIT 1
        """, (map_name,)).fetchone()

        d = dict(row)
        d["king"]        = dict(king)        if king        else None
        d["most_played"] = dict(most_played) if most_played else None
        result.append(d)

    return result


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


REGULAR_PLAYER_MIN_MATCHES = 5


def snapshot_ranks(conn: sqlite3.Connection, season_id: int | None = None) -> None:
    """Save current rating-sorted ranks before a new match is added."""
    if season_id is None:
        rows = conn.execute(
            """SELECT steamid,
                      ROUND(SUM(rating * rounds_played) / SUM(rounds_played), 4) AS avg_rating
               FROM player_ratings GROUP BY steamid ORDER BY avg_rating DESC"""
        ).fetchall()
    else:
        season = get_season(conn, season_id)
        if not season:
            return
        start = season["start_date"]
        end   = season["end_date"] or datetime.now(timezone.utc).isoformat()
        rows  = conn.execute(
            """SELECT pr.steamid,
                      ROUND(SUM(pr.rating * pr.rounds_played) / SUM(pr.rounds_played), 4) AS avg_rating
               FROM player_ratings pr
               JOIN matches m ON m.id = pr.match_id
               WHERE m.uploaded_at >= ? AND m.uploaded_at <= ?
               GROUP BY pr.steamid ORDER BY avg_rating DESC""",
            (start, end),
        ).fetchall()

    sid_val = season_id  # None stored as NULL
    for rank, row in enumerate(rows, start=1):
        conn.execute(
            """INSERT INTO lb_rank_snapshots (steamid, season_id, rank)
               VALUES (?, ?, ?)
               ON CONFLICT(steamid, season_id) DO UPDATE SET rank=excluded.rank""",
            (row["steamid"], sid_val, rank),
        )
    conn.commit()


def _attach_prev_ranks(players: list[dict], conn: sqlite3.Connection, season_id: int | None) -> None:
    if not players:
        return
    rows = conn.execute(
        "SELECT steamid, rank FROM lb_rank_snapshots WHERE season_id IS ?",
        (season_id,),
    ).fetchall()
    prev = {r["steamid"]: r["rank"] for r in rows}
    for p in players:
        p["prev_rank"] = prev.get(p["steamid"])


def get_leaderboard(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("""
        SELECT
            steamid,
            MAX(name) AS name,
            ROUND(SUM(rating * rounds_played) / SUM(rounds_played), 4) AS avg_rating,
            ROUND(SUM(adr  * rounds_played)   / SUM(rounds_played), 1) AS avg_adr,
            ROUND(SUM(kast * rounds_played)   / SUM(rounds_played), 1) AS avg_kast,
            ROUND(SUM(kpr  * rounds_played)   / SUM(rounds_played), 3) AS avg_kpr,
            ROUND(SUM(dpr  * rounds_played)   / SUM(rounds_played), 3) AS avg_dpr,
            ROUND(SUM(hs_pct      * rounds_played) / SUM(rounds_played), 1) AS avg_hs_pct,
            ROUND(SUM(survive_pct * rounds_played) / SUM(rounds_played), 1) AS avg_survive_pct,
            SUM(kills)               AS total_kills,
            SUM(deaths)              AS total_deaths,
            SUM(assists)             AS total_assists,
            SUM(rounds_played)       AS total_rounds,
            SUM(opening_kills)       AS total_opening_kills,
            SUM(opening_attempts)    AS total_opening_attempts,
            SUM(flash_enemies)       AS total_flash_enemies,
            SUM(clutch_won)          AS total_clutch_won,
            SUM(clutch_total)        AS total_clutch_total,
            SUM(knife_kills)         AS total_knife_kills,
            SUM(zeus_kills)          AS total_zeus_kills,
            COUNT(DISTINCT match_id) AS matches_played
        FROM player_ratings
        GROUP BY steamid
        ORDER BY avg_rating DESC
    """).fetchall()
    all_rows = [dict(r) for r in rows]
    players = [r for r in all_rows if r["matches_played"] >= REGULAR_PLAYER_MIN_MATCHES]
    guests  = [r for r in all_rows if r["matches_played"] <  REGULAR_PLAYER_MIN_MATCHES]
    _attach_prev_ranks(players, conn, None)
    _attach_prev_ranks(guests,  conn, None)
    return {"players": players, "guests": guests}


# ── Seasons ───────────────────────────────────────────────────────────────────


def create_season(conn: sqlite3.Connection, name: str, start_date: str, end_date: str | None = None) -> int:
    cur = conn.execute(
        "INSERT INTO seasons (name, start_date, end_date, is_active, created_at) VALUES (?, ?, ?, 1, ?)",
        (name, start_date, end_date, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    return cur.lastrowid


def get_season(conn: sqlite3.Connection, season_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM seasons WHERE id = ?", (season_id,)).fetchone()
    return dict(row) if row else None


def get_all_seasons(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM seasons ORDER BY start_date DESC").fetchall()
    return [dict(r) for r in rows]


def get_active_season(conn: sqlite3.Connection) -> dict | None:
    row = conn.execute(
        "SELECT * FROM seasons WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    return dict(row) if row else None


def close_season(conn: sqlite3.Connection, season_id: int, end_date: str) -> None:
    conn.execute(
        "UPDATE seasons SET is_active = 0, end_date = ? WHERE id = ?",
        (end_date, season_id),
    )
    conn.commit()


def delete_season(conn: sqlite3.Connection, season_id: int) -> bool:
    row = conn.execute("SELECT is_active FROM seasons WHERE id = ?", (season_id,)).fetchone()
    if row is None:
        return False
    conn.execute("DELETE FROM player_titles WHERE season_id = ?", (season_id,))
    conn.execute("DELETE FROM seasons WHERE id = ?", (season_id,))
    conn.commit()
    return True


SEASON_PARTICIPATION_THRESHOLD = 0.10  # must have played ≥10% of season matches


def get_season_leaderboard(conn: sqlite3.Connection, season_id: int) -> dict | None:
    season = get_season(conn, season_id)
    if not season:
        return None

    start = season["start_date"]
    end   = season["end_date"] or datetime.now(timezone.utc).isoformat()

    total_matches = conn.execute(
        "SELECT COUNT(*) FROM matches WHERE uploaded_at >= ? AND uploaded_at <= ?",
        (start, end),
    ).fetchone()[0]

    # floor(20% of total matches), minimum 1 — threshold grows only at full multiples of 5
    min_matches = max(1, total_matches // 5)

    rows = conn.execute("""
        SELECT
            pr.steamid,
            MAX(pr.name) AS name,
            ROUND(SUM(pr.rating       * pr.rounds_played) / SUM(pr.rounds_played), 4) AS avg_rating,
            ROUND(SUM(pr.adr          * pr.rounds_played) / SUM(pr.rounds_played), 1) AS avg_adr,
            ROUND(SUM(pr.kast         * pr.rounds_played) / SUM(pr.rounds_played), 1) AS avg_kast,
            ROUND(SUM(pr.kpr          * pr.rounds_played) / SUM(pr.rounds_played), 3) AS avg_kpr,
            ROUND(SUM(pr.dpr          * pr.rounds_played) / SUM(pr.rounds_played), 3) AS avg_dpr,
            ROUND(SUM(pr.hs_pct       * pr.rounds_played) / SUM(pr.rounds_played), 1) AS avg_hs_pct,
            ROUND(SUM(pr.survive_pct  * pr.rounds_played) / SUM(pr.rounds_played), 1) AS avg_survive_pct,
            SUM(pr.kills)               AS total_kills,
            SUM(pr.deaths)              AS total_deaths,
            SUM(pr.assists)             AS total_assists,
            SUM(pr.rounds_played)       AS total_rounds,
            SUM(pr.opening_kills)       AS total_opening_kills,
            SUM(pr.opening_attempts)    AS total_opening_attempts,
            SUM(pr.flash_enemies)       AS total_flash_enemies,
            SUM(pr.clutch_won)          AS total_clutch_won,
            SUM(pr.clutch_total)        AS total_clutch_total,
            SUM(pr.knife_kills)         AS total_knife_kills,
            SUM(pr.zeus_kills)          AS total_zeus_kills,
            COUNT(DISTINCT pr.match_id) AS matches_played
        FROM player_ratings pr
        JOIN matches m ON m.id = pr.match_id
        WHERE m.uploaded_at >= ? AND m.uploaded_at <= ?
        GROUP BY pr.steamid
        HAVING matches_played >= ?
        ORDER BY avg_rating DESC
    """, (start, end, min_matches)).fetchall()

    all_rows = [dict(r) for r in rows]
    _attach_prev_ranks(all_rows, conn, season_id)
    return {
        "players":       all_rows,
        "guests":        [],
        "season":        season,
        "total_matches": total_matches,
        "min_matches":   min_matches,
    }


def get_all_titles(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("""
        SELECT pt.*, s.name AS season_name
        FROM player_titles pt
        JOIN seasons s ON s.id = pt.season_id
        ORDER BY pt.earned_at DESC
    """).fetchall()

    result: dict[str, list] = {}
    for row in rows:
        d = dict(row)
        sid = d["steamid"]
        if sid not in result:
            result[sid] = []
        result[sid].append(d)
    return result


def get_season_titles(conn: sqlite3.Connection, season_id: int) -> list[dict]:
    rows = conn.execute("""
        SELECT
            pt.*,
            s.name AS season_name,
            (SELECT MAX(pr2.name) FROM player_ratings pr2 WHERE pr2.steamid = pt.steamid) AS player_name
        FROM player_titles pt
        JOIN seasons s ON s.id = pt.season_id
        WHERE pt.season_id = ?
        ORDER BY pt.id ASC
    """, (season_id,)).fetchall()
    return [dict(r) for r in rows]


def insert_player_titles(conn: sqlite3.Connection, titles: list[dict]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    conn.executemany(
        """INSERT INTO player_titles
           (season_id, steamid, award_type, award_label, flavor_text, stat_value, earned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        [
            (t["season_id"], t["steamid"], t["award_type"], t["award_label"],
             t.get("flavor_text"), t.get("stat_value"), now)
            for t in titles
        ],
    )
    conn.commit()
