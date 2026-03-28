import bz2
import gzip
import math
import os
import tempfile
from collections import defaultdict
from pathlib import Path

from demoparser2 import DemoParser


DEATH_PLAYER_FIELDS = ["X", "Y", "Z", "team_name", "health"]
DEATH_OTHER_FIELDS  = ["total_rounds_played"]

DAMAGE_PLAYER_FIELDS = ["team_name", "health"]
DAMAGE_OTHER_FIELDS  = ["total_rounds_played"]

ROUND_OTHER_FIELDS = ["total_rounds_played"]

# Ticks within which a kill counts as a "trade" (~3 s at 64 tick)
TRADE_WINDOW_TICKS = 192


def _decompress(src: Path, tmp_dir: str) -> Path:
    suffix = "".join(src.suffixes)
    if suffix.endswith(".bz2"):
        dst = Path(tmp_dir) / src.stem
        with bz2.open(src, "rb") as f_in, open(dst, "wb") as f_out:
            f_out.write(f_in.read())
        return dst
    if suffix.endswith(".gz"):
        dst = Path(tmp_dir) / src.stem
        with gzip.open(src, "rb") as f_in, open(dst, "wb") as f_out:
            f_out.write(f_in.read())
        return dst
    return src


def _clean(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def _df_to_records(df):
    return [{k: _clean(v) for k, v in row.items()} for row in df.to_dict(orient="records")]


# ── HLTV 2.0 Rating ──────────────────────────────────────────────────────────

def _compute_ratings(kills_df, damages_df, rounds_df, spawn_df=None):
    """
    Compute HLTV 2.0 rating for each player.

    Rating = 0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587
    Impact ≈ 2.13·KPR + 0.42·APR − 0.41

    Source: https://dave.xn--tckwe/posts/reverse-engineering-hltv-rating/
    """
    total_rounds = len(rounds_df)
    if total_rounds == 0:
        return []

    # ── 1. Collect players and their rounds from spawn events (if available) ──
    # player_rounds[steamid] = set of round numbers they were alive in
    player_rounds: dict[str, set] = defaultdict(set)
    player_names:  dict[str, str] = {}
    player_teams:  dict[str, str] = {}

    if spawn_df is not None and len(spawn_df):
        for _, row in spawn_df.iterrows():
            sid  = str(row.get("user_steamid") or "")
            name = row.get("user_name") or ""
            rnd  = row.get("total_rounds_played")
            team = row.get("user_team_name") or ""
            if sid and rnd is not None:
                player_rounds[sid].add(int(rnd))
                player_names[sid] = name
                if team:
                    player_teams[sid] = team

    # Fallback: derive players from kills/damages if no spawn data
    for _, row in kills_df.iterrows():
        rnd = row.get("total_rounds_played")
        if rnd is None:
            continue
        rnd = int(rnd)
        for role in ("attacker", "user", "assister"):
            sid  = str(row.get(f"{role}_steamid") or "")
            name = row.get(f"{role}_name") or ""
            team = row.get(f"{role}_team_name") or ""
            if sid and sid != "None":
                player_rounds[sid].add(rnd)
                if name:
                    player_names[sid] = name
                if team:
                    player_teams[sid] = team

    for _, row in damages_df.iterrows():
        rnd = row.get("total_rounds_played")
        if rnd is None:
            continue
        rnd = int(rnd)
        for role in ("attacker", "user"):
            sid  = str(row.get(f"{role}_steamid") or "")
            name = row.get(f"{role}_name") or ""
            team = row.get(f"{role}_team_name") or ""
            if sid and sid != "None":
                player_rounds[sid].add(rnd)
                if name:
                    player_names[sid] = name
                if team:
                    player_teams[sid] = team

    # ── 2. Per-round kill / assist / death / damage sets ─────────────────────
    # round_kills[rnd]   = list of {attacker, victim, assister, tick}
    round_kills:   dict[int, list] = defaultdict(list)
    # round_deaths[rnd]  = {victim_steamid}
    round_deaths:  dict[int, set]  = defaultdict(set)
    # round_assists[rnd] = {assister_steamid}
    round_assists: dict[int, set]  = defaultdict(set)

    kills_by_attacker_round: dict[tuple, int] = defaultdict(int)   # (steamid, rnd) -> kills
    assists_by_player_round: dict[tuple, int] = defaultdict(int)   # (steamid, rnd) -> assists

    for _, row in kills_df.iterrows():
        rnd  = row.get("total_rounds_played")
        if rnd is None:
            continue
        rnd  = int(rnd)
        atk      = str(row.get("attacker_steamid") or "")
        vic      = str(row.get("user_steamid") or "")
        asst     = str(row.get("assister_steamid") or "")
        tick     = row.get("tick") or 0
        atk_team = row.get("attacker_team_name") or ""
        vic_team = row.get("user_team_name") or ""
        team_kill = atk_team == vic_team and atk_team != ""

        # Only enemy kills count toward K in KPR/KAST
        if atk and atk != "None" and not team_kill:
            round_kills[rnd].append({"attacker": atk, "victim": vic, "tick": tick})
            kills_by_attacker_round[(atk, rnd)] += 1

        # Deaths count regardless (team-killed players still died)
        if vic and vic != "None":
            round_deaths[rnd].add(vic)

        if asst and asst != "None":
            round_assists[rnd].add(asst)
            assists_by_player_round[(asst, rnd)] += 1

    # ── 3. Damage per (player, round) ────────────────────────────────────────
    damage_by_player_round: dict[tuple, float] = defaultdict(float)

    for _, row in damages_df.iterrows():
        rnd = row.get("total_rounds_played")
        if rnd is None:
            continue
        rnd = int(rnd)
        atk = str(row.get("attacker_steamid") or "")
        raw_dmg = float(row.get("dmg_health") or 0)
        # user_health is victim's HP *before* the hit — cap overkill damage
        vic_hp = row.get("user_health")
        if vic_hp is not None and not (isinstance(vic_hp, float) and math.isnan(vic_hp)):
            dmg = min(raw_dmg, float(vic_hp))
        else:
            dmg = min(raw_dmg, 100.0)  # safe fallback
        # don't count team-damage (same team_name)
        atk_team = row.get("attacker_team_name") or ""
        vic_team = row.get("user_team_name") or ""
        if atk and atk != "None" and atk_team != vic_team:
            damage_by_player_round[(atk, rnd)] += dmg

    # ── 4. Trade detection ────────────────────────────────────────────────────
    # traded[rnd] = {steamid} — players who were killed but traded within window
    traded: dict[int, set] = defaultdict(set)

    for rnd, kill_list in round_kills.items():
        # Sort by tick
        sorted_kills = sorted(kill_list, key=lambda k: k["tick"])
        # For each kill, check if the attacker was later killed within window
        for i, kill in enumerate(sorted_kills):
            victim   = kill["victim"]
            attacker = kill["attacker"]
            kill_tick = kill["tick"]
            for later in sorted_kills[i + 1:]:
                if later["tick"] - kill_tick > TRADE_WINDOW_TICKS:
                    break
                if later["victim"] == attacker:
                    traded[rnd].add(victim)
                    break

    # ── 5. Compute per-player aggregates ─────────────────────────────────────
    results = []

    for sid, rounds_played in player_rounds.items():
        name = player_names.get(sid, sid)
        team = player_teams.get(sid, "")
        n    = len(rounds_played)  # rounds this player participated in
        if n == 0:
            continue

        total_kills   = sum(kills_by_attacker_round.get((sid, r), 0) for r in rounds_played)
        total_deaths  = sum(1 for r in rounds_played if sid in round_deaths.get(r, set()))
        total_assists = sum(assists_by_player_round.get((sid, r), 0) for r in rounds_played)
        total_damage  = sum(damage_by_player_round.get((sid, r), 0.0) for r in rounds_played)

        kast_rounds = 0
        for r in rounds_played:
            killed   = kills_by_attacker_round.get((sid, r), 0) > 0
            assisted = sid in round_assists.get(r, set())
            survived = sid not in round_deaths.get(r, set())
            was_traded = sid in traded.get(r, set())
            if killed or assisted or survived or was_traded:
                kast_rounds += 1

        kast   = kast_rounds / n
        kpr    = total_kills  / n
        dpr    = total_deaths / n
        apr    = total_assists / n
        adr    = total_damage / n

        impact = 2.13 * kpr + 0.42 * apr - 0.41
        rating = (
            0.0073 * (kast * 100)
            + 0.3591 * kpr
            - 0.5329 * dpr
            + 0.2372 * impact
            + 0.0032 * adr
            + 0.1587
        )

        results.append({
            "steamid":  sid,
            "name":     name,
            "team":     team,
            "rating":   round(rating, 4),
            "kast":     round(kast * 100, 1),
            "kpr":      round(kpr, 3),
            "dpr":      round(dpr, 3),
            "apr":      round(apr, 3),
            "adr":      round(adr, 1),
            "impact":   round(impact, 3),
            "kills":    total_kills,
            "deaths":   total_deaths,
            "assists":  total_assists,
            "rounds":   n,
        })

    results.sort(key=lambda p: p["rating"], reverse=True)
    return results


# ── Main entry point ──────────────────────────────────────────────────────────

def parse_demo(file_path: str | Path) -> dict:
    file_path = Path(file_path)

    with tempfile.TemporaryDirectory() as tmp_dir:
        dem_path = _decompress(file_path, tmp_dir)
        p = DemoParser(str(dem_path))

        header           = p.parse_header()
        available_events = p.list_game_events()

        kills = p.parse_event(
            "player_death",
            player=DEATH_PLAYER_FIELDS,
            other=DEATH_OTHER_FIELDS,
        )

        damages = p.parse_event(
            "player_hurt",
            player=DAMAGE_PLAYER_FIELDS,
            other=DAMAGE_OTHER_FIELDS,
        )

        rounds = p.parse_event("round_end", other=ROUND_OTHER_FIELDS)

        spawn_df = None
        if "player_spawn" in available_events:
            spawn_df = p.parse_event(
                "player_spawn",
                player=["team_name"],
                other=["total_rounds_played"],
            )

        ratings = _compute_ratings(kills, damages, rounds, spawn_df)

        bomb_events = {}
        for ev in ("bomb_planted", "bomb_defused", "bomb_dropped"):
            if ev in available_events:
                bomb_events[ev] = _df_to_records(
                    p.parse_event(ev, other=["total_rounds_played"])
                )

        grenade_events = {}
        for ev in ("hegrenade_detonate", "smokegrenade_expired", "inferno_expire", "decoy_started"):
            if ev in available_events:
                grenade_events[ev] = _df_to_records(
                    p.parse_event(ev, player=["X", "Y", "Z", "team_name"])
                )

    return {
        "header":           header,
        "available_events": available_events,
        "ratings":          ratings,
        "rounds":           _df_to_records(rounds),
        "kills":            _df_to_records(kills),
        "damages":          _df_to_records(damages),
        "bomb_events":      bomb_events,
        "grenade_events":   grenade_events,
    }
