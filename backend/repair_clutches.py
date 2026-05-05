from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import awards  # noqa: E402
import database  # noqa: E402
from parser import _compute_ratings  # noqa: E402


def _default_db_path() -> Path:
    return ROOT / "data" / "mix_parser.db"


def _default_data_dir() -> Path:
    return ROOT / "data"


def _build_round_winners(rounds: list[dict]) -> dict[int, str | None]:
    return {
        int(r.get("total_rounds_played", 0)) - 1: r.get("winner")
        for r in rounds
        if r.get("total_rounds_played")
    }


def _df(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows or [])


def repair_match_clutches(conn, data_dir: Path, match_id: int, dry_run: bool = False) -> int:
    payload = database.load_match_data(data_dir, match_id)
    if not payload:
        print(f"[skip] match {match_id}: missing {match_id}.json.gz")
        return 0

    rounds = payload.get("rounds", [])
    ratings = _compute_ratings(
        _df(payload.get("kills", [])),
        _df(payload.get("damages", [])),
        _df(rounds),
        None,
        _df(payload.get("blind_events", [])),
        _build_round_winners(rounds),
    )

    clutch_by_steamid = {
        row["steamid"]: (
            int(row.get("clutch_won") or 0),
            int(row.get("clutch_total") or 0),
        )
        for row in ratings
    }

    rows = conn.execute(
        "SELECT id, steamid, clutch_won, clutch_total FROM player_ratings WHERE match_id = ?",
        (match_id,),
    ).fetchall()

    changed = 0
    updates: list[tuple[int, int, int]] = []
    for row in rows:
        new_vals = clutch_by_steamid.get(row["steamid"])
        if not new_vals:
            continue
        new_won, new_total = new_vals
        cur_won = int(row["clutch_won"] or 0)
        cur_total = int(row["clutch_total"] or 0)
        if cur_won != new_won or cur_total != new_total:
            changed += 1
            updates.append((new_won, new_total, row["id"]))

    if updates and not dry_run:
        conn.executemany(
            "UPDATE player_ratings SET clutch_won = ?, clutch_total = ? WHERE id = ?",
            updates,
        )

    if changed:
        print(f"[fix] match {match_id}: updated {changed} player rows")
    return changed


def rebuild_closed_season_titles(conn, include_active: bool = False, dry_run: bool = False) -> int:
    seasons = database.get_all_seasons(conn)
    rebuilt = 0

    for season in seasons:
        if season["is_active"] and not include_active:
            continue

        lb = database.get_season_leaderboard(conn, season["id"])
        if not lb:
            continue

        all_players = (lb["players"] if lb["players"] else []) + (lb["guests"] if lb["guests"] else [])
        titles = awards.generate_season_awards(all_players, season["id"])

        if dry_run:
            print(f"[dry-run] season {season['id']}: would delete and recreate {len(titles)} titles")
        else:
            conn.execute("DELETE FROM player_titles WHERE season_id = ?", (season["id"],))
            if titles:
                database.insert_player_titles(conn, titles)
            rebuilt += 1
            print(f"[fix] season {season['id']}: regenerated {len(titles)} titles")

    if not dry_run:
        conn.commit()

    return rebuilt


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recalculate clutch stats from stored match JSON and refresh season awards.")
    parser.add_argument("--db", type=Path, default=_default_db_path(), help="Path to mix_parser.db")
    parser.add_argument("--data-dir", type=Path, default=_default_data_dir(), help="Directory with <match_id>.json.gz files")
    parser.add_argument("--dry-run", action="store_true", help="Show changes without writing them")
    parser.add_argument("--skip-titles", action="store_true", help="Only fix player_ratings clutch columns")
    parser.add_argument("--include-active-seasons", action="store_true", help="Also rebuild titles for active seasons")
    args = parser.parse_args()

    if not args.db.exists():
        print(f"Database not found: {args.db}")
        return 1

    conn = database.get_connection(args.db)
    try:
        match_rows = conn.execute("SELECT id FROM matches ORDER BY id ASC").fetchall()
        total_changed = 0

        for row in match_rows:
            total_changed += repair_match_clutches(conn, args.data_dir, row["id"], dry_run=args.dry_run)

        print(f"Processed {len(match_rows)} matches; changed {total_changed} player rows")

        if not args.skip_titles:
            rebuild_closed_season_titles(
                conn,
                include_active=args.include_active_seasons,
                dry_run=args.dry_run,
            )
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())