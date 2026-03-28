import bz2
import gzip
import math
import tempfile
from collections import defaultdict
from pathlib import Path

from demoparser2 import DemoParser


DEATH_PLAYER_FIELDS  = ["X", "Y", "Z", "team_name", "health"]
DEATH_OTHER_FIELDS   = ["total_rounds_played"]
DAMAGE_PLAYER_FIELDS = ["team_name", "health"]
DAMAGE_OTHER_FIELDS  = ["total_rounds_played"]
ROUND_OTHER_FIELDS   = ["total_rounds_played"]

# ~3 s at 64 tick
TRADE_WINDOW_TICKS = 192
# minimum blind duration to count as a meaningful flash
MIN_BLIND_DURATION = 0.5


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


# ── HLTV 2.0 Rating + extended stats ─────────────────────────────────────────

def _compute_ratings(kills_df, damages_df, rounds_df, spawn_df=None,
                     blind_df=None, round_winners=None):
    """
    Returns list of per-player dicts with HLTV 2.0 rating and extended stats.

    Extended stats (all derivable from kills/damages/blind events):
      - multi_kills:      {2: N, 3: N, 4: N, 5: N}
      - opening_kills:    int
      - opening_attempts: int  (rounds where player got first kill of team)
      - opening_success:  float (opening_kills / opening_attempts)
      - ct_rating/t_rating, ct_rounds/t_rounds
      - flash_enemies:    enemies blinded (duration >= MIN_BLIND_DURATION)
      - flash_duration:   avg blind duration on enemies
      - clutch_won/clutch_total: 1vX clutch situations
      - hs_pct:           headshot percentage
      - survive_pct:      % rounds survived
    """
    total_rounds = len(rounds_df)
    if total_rounds == 0:
        return []

    # ── 1. Player registry from spawns ───────────────────────────────────────
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

    # ── 2. Build per-round kill structures ───────────────────────────────────
    # round_kills[rnd] = list of {attacker, victim, tick, atk_team, vic_team, headshot}
    round_kills:   dict[int, list] = defaultdict(list)
    round_deaths:  dict[int, set]  = defaultdict(set)
    round_assists: dict[int, set]  = defaultdict(set)

    kills_by_attacker_round: dict[tuple, int] = defaultdict(int)
    assists_by_player_round: dict[tuple, int] = defaultdict(int)
    hs_by_player:            dict[str, int]   = defaultdict(int)

    for _, row in kills_df.iterrows():
        rnd = row.get("total_rounds_played")
        if rnd is None:
            continue
        rnd      = int(rnd)
        atk      = str(row.get("attacker_steamid") or "")
        vic      = str(row.get("user_steamid") or "")
        asst     = str(row.get("assister_steamid") or "")
        tick     = row.get("tick") or 0
        atk_team = row.get("attacker_team_name") or ""
        vic_team = row.get("user_team_name") or ""
        hs       = bool(row.get("headshot"))
        team_kill = atk_team == vic_team and atk_team != ""

        if atk and atk != "None" and not team_kill:
            round_kills[rnd].append({
                "attacker": atk, "victim": vic, "tick": tick,
                "atk_team": atk_team, "vic_team": vic_team, "headshot": hs,
            })
            kills_by_attacker_round[(atk, rnd)] += 1
            if hs:
                hs_by_player[atk] += 1

        if vic and vic != "None":
            round_deaths[rnd].add(vic)

        if asst and asst != "None":
            round_assists[rnd].add(asst)
            assists_by_player_round[(asst, rnd)] += 1

    # ── 3. Damage (HP-capped) ────────────────────────────────────────────────
    damage_by_player_round: dict[tuple, float] = defaultdict(float)

    for _, row in damages_df.iterrows():
        rnd = row.get("total_rounds_played")
        if rnd is None:
            continue
        rnd     = int(rnd)
        atk     = str(row.get("attacker_steamid") or "")
        raw_dmg = float(row.get("dmg_health") or 0)
        vic_hp  = row.get("user_health")
        if vic_hp is not None and not (isinstance(vic_hp, float) and math.isnan(vic_hp)):
            dmg = min(raw_dmg, float(vic_hp))
        else:
            dmg = min(raw_dmg, 100.0)
        atk_team = row.get("attacker_team_name") or ""
        vic_team = row.get("user_team_name") or ""
        if atk and atk != "None" and atk_team != vic_team:
            damage_by_player_round[(atk, rnd)] += dmg

    # ── 4. Trade detection ───────────────────────────────────────────────────
    traded: dict[int, set] = defaultdict(set)
    for rnd, kill_list in round_kills.items():
        sorted_kills = sorted(kill_list, key=lambda k: k["tick"])
        for i, kill in enumerate(sorted_kills):
            kill_tick = kill["tick"]
            for later in sorted_kills[i + 1:]:
                if later["tick"] - kill_tick > TRADE_WINDOW_TICKS:
                    break
                if later["victim"] == kill["attacker"]:
                    traded[rnd].add(kill["victim"])
                    break

    # ── 5. Opening kills (first enemy kill per round) ────────────────────────
    # opening_kills[steamid]    = rounds where they got the opening kill
    # opening_duels[steamid]    = rounds where they were involved in opening duel
    opening_killer:   dict[int, str] = {}   # rnd -> steamid of first killer
    opening_victim:   dict[int, str] = {}   # rnd -> steamid of first victim
    for rnd, kill_list in round_kills.items():
        if kill_list:
            first = min(kill_list, key=lambda k: k["tick"])
            opening_killer[rnd] = first["attacker"]
            opening_victim[rnd] = first["victim"]

    opening_kills_by_player:   dict[str, int] = defaultdict(int)
    opening_attempts_by_player: dict[str, int] = defaultdict(int)
    for rnd, killer in opening_killer.items():
        opening_kills_by_player[killer] += 1
        opening_attempts_by_player[killer] += 1
        victim = opening_victim.get(rnd)
        if victim:
            opening_attempts_by_player[victim] += 1

    # ── 6. Multi-kills per round ─────────────────────────────────────────────
    multi_kills: dict[str, dict] = defaultdict(lambda: {2: 0, 3: 0, 4: 0, 5: 0})
    for rnd, kill_list in round_kills.items():
        kills_per_atk: dict[str, int] = defaultdict(int)
        for k in kill_list:
            kills_per_atk[k["attacker"]] += 1
        for sid, n in kills_per_atk.items():
            if 2 <= n <= 5:
                multi_kills[sid][n] += 1

    # ── 7. CT / T side stats ─────────────────────────────────────────────────
    # For each player/round, determine which side they were on
    player_side_rounds: dict[str, dict[str, set]] = defaultdict(lambda: {"CT": set(), "TERRORIST": set()})
    if spawn_df is not None and len(spawn_df):
        for _, row in spawn_df.iterrows():
            sid  = str(row.get("user_steamid") or "")
            rnd  = row.get("total_rounds_played")
            team = row.get("user_team_name") or ""
            if sid and rnd is not None and team in ("CT", "TERRORIST"):
                player_side_rounds[sid][team].add(int(rnd))
    else:
        # fallback: derive from kill events
        for rnd, kill_list in round_kills.items():
            for k in kill_list:
                atk = k["attacker"]
                t   = k["atk_team"]
                if t in ("CT", "TERRORIST"):
                    player_side_rounds[atk][t].add(rnd)

    # ── 8. Flash stats ───────────────────────────────────────────────────────
    flash_enemies_by_player:  dict[str, int]   = defaultdict(int)
    flash_duration_by_player: dict[str, float] = defaultdict(float)

    if blind_df is not None and len(blind_df):
        for _, row in blind_df.iterrows():
            atk      = str(row.get("attacker_steamid") or "")
            atk_team = row.get("attacker_team_name") or ""
            vic_team = row.get("user_team_name") or ""
            dur      = float(row.get("blind_duration") or 0)
            if atk and atk != "None" and atk_team != vic_team and dur >= MIN_BLIND_DURATION:
                flash_enemies_by_player[atk] += 1
                flash_duration_by_player[atk] += dur

    # ── 9. Clutch detection (1vX) ────────────────────────────────────────────
    # A clutch: player is the last alive on their team while enemies remain alive
    # Track alive counts per round over time
    clutch_won:   dict[str, int] = defaultdict(int)
    clutch_total: dict[str, int] = defaultdict(int)

    for rnd, kill_list in round_kills.items():
        sorted_kills = sorted(kill_list, key=lambda k: k["tick"])

        # Determine starting teams from spawns or kills
        alive: dict[str, str] = {}  # steamid -> team
        for sid in player_rounds:
            if rnd in player_rounds[sid]:
                team = ""
                if spawn_df is not None and len(spawn_df):
                    side_ct = player_side_rounds[sid]["CT"]
                    side_t  = player_side_rounds[sid]["TERRORIST"]
                    if rnd in side_ct:
                        team = "CT"
                    elif rnd in side_t:
                        team = "TERRORIST"
                else:
                    team = player_teams.get(sid, "")
                if team:
                    alive[sid] = team

        clutch_candidate: dict[str, bool] = {}  # steamid -> already flagged

        for kill in sorted_kills:
            vic = kill["victim"]
            if vic in alive:
                del alive[vic]

            # After each kill, check for 1vX
            team_counts: dict[str, int] = defaultdict(int)
            for sid, team in alive.items():
                team_counts[team] += 1

            for team, cnt in team_counts.items():
                if cnt == 1:
                    # Find the last player alive on this team
                    last = next((sid for sid, t in alive.items() if t == team), None)
                    if last and not clutch_candidate.get(last):
                        enemies_alive = sum(c for t, c in team_counts.items() if t != team)
                        if enemies_alive >= 1:
                            clutch_total[last] += 1
                            clutch_candidate[last] = True

        # Determine clutch winners: player survived or their team won the round
        winner_team = round_winners.get(rnd) if round_winners else None
        for sid, flagged in clutch_candidate.items():
            if not flagged:
                continue
            survived = sid not in round_deaths.get(rnd, set())
            team     = player_side_rounds[sid]["CT"] and "CT" or "TERRORIST"
            won      = survived or (winner_team and winner_team == player_teams.get(sid))
            if won:
                clutch_won[sid] += 1

    # ── 10. Compute final per-player results ─────────────────────────────────
    results = []

    for sid, rounds_played in player_rounds.items():
        name = player_names.get(sid, sid)
        team = player_teams.get(sid, "")
        n    = len(rounds_played)
        if n == 0:
            continue

        total_kills   = sum(kills_by_attacker_round.get((sid, r), 0) for r in rounds_played)
        total_deaths  = sum(1 for r in rounds_played if sid in round_deaths.get(r, set()))
        total_assists = sum(assists_by_player_round.get((sid, r), 0) for r in rounds_played)
        total_damage  = sum(damage_by_player_round.get((sid, r), 0.0) for r in rounds_played)

        kast_rounds = 0
        survived_rounds = 0
        for r in rounds_played:
            killed     = kills_by_attacker_round.get((sid, r), 0) > 0
            assisted   = sid in round_assists.get(r, set())
            survived   = sid not in round_deaths.get(r, set())
            was_traded = sid in traded.get(r, set())
            if survived:
                survived_rounds += 1
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

        # CT / T split ratings
        def _side_rating(side_rounds):
            sn = len(side_rounds)
            if sn == 0:
                return None, 0
            sk  = sum(kills_by_attacker_round.get((sid, r), 0) for r in side_rounds)
            sd  = sum(1 for r in side_rounds if sid in round_deaths.get(r, set()))
            sa  = sum(assists_by_player_round.get((sid, r), 0) for r in side_rounds)
            sdmg = sum(damage_by_player_round.get((sid, r), 0.0) for r in side_rounds)
            skast = sum(
                1 for r in side_rounds
                if kills_by_attacker_round.get((sid, r), 0) > 0
                or sid in round_assists.get(r, set())
                or sid not in round_deaths.get(r, set())
                or sid in traded.get(r, set())
            )
            s_kast = skast / sn
            s_kpr  = sk / sn
            s_dpr  = sd / sn
            s_apr  = sa / sn
            s_adr  = sdmg / sn
            s_imp  = 2.13 * s_kpr + 0.42 * s_apr - 0.41
            s_rat  = (0.0073 * (s_kast * 100) + 0.3591 * s_kpr
                      - 0.5329 * s_dpr + 0.2372 * s_imp + 0.0032 * s_adr + 0.1587)
            return round(s_rat, 4), sn

        ct_rounds_set = player_side_rounds[sid]["CT"]    & rounds_played
        t_rounds_set  = player_side_rounds[sid]["TERRORIST"] & rounds_played
        ct_rat, ct_n  = _side_rating(ct_rounds_set)
        t_rat,  t_n   = _side_rating(t_rounds_set)

        # Flash
        fe   = flash_enemies_by_player.get(sid, 0)
        ftot = flash_duration_by_player.get(sid, 0.0)
        favg = round(ftot / fe, 2) if fe > 0 else 0.0

        # Multi-kills
        mk = multi_kills.get(sid, {2: 0, 3: 0, 4: 0, 5: 0})

        # HS%
        hs_pct = round(hs_by_player.get(sid, 0) / total_kills * 100, 1) if total_kills else 0.0

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
            "hs_pct":       hs_pct,
            "survive_pct":  round(survived_rounds / n * 100, 1),
            "multi_kills":  {str(k): v for k, v in mk.items() if v > 0},
            "opening_kills":    opening_kills_by_player.get(sid, 0),
            "opening_attempts": opening_attempts_by_player.get(sid, 0),
            "ct_rating":  ct_rat,
            "ct_rounds":  ct_n,
            "t_rating":   t_rat,
            "t_rounds":   t_n,
            "flash_enemies":  fe,
            "flash_avg_dur":  favg,
            "clutch_won":     clutch_won.get(sid, 0),
            "clutch_total":   clutch_total.get(sid, 0),
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

        kills   = p.parse_event("player_death", player=DEATH_PLAYER_FIELDS, other=DEATH_OTHER_FIELDS)
        damages = p.parse_event("player_hurt",  player=DAMAGE_PLAYER_FIELDS, other=DAMAGE_OTHER_FIELDS)
        rounds  = p.parse_event("round_end",    other=ROUND_OTHER_FIELDS)

        spawn_df = None
        if "player_spawn" in available_events:
            spawn_df = p.parse_event("player_spawn", player=["team_name"], other=["total_rounds_played"])

        blind_df = None
        if "player_blind" in available_events:
            blind_df = p.parse_event("player_blind", player=["team_name"], other=["total_rounds_played"])

        # round number -> winning team name
        round_winners = {
            int(r.get("total_rounds_played", 0)) - 1: r.get("winner")
            for r in _df_to_records(rounds)
            if r.get("total_rounds_played")
        }

        ratings = _compute_ratings(kills, damages, rounds, spawn_df, blind_df, round_winners)

        bomb_events = {}
        for ev in ("bomb_planted", "bomb_defused", "bomb_dropped"):
            if ev in available_events:
                bomb_events[ev] = _df_to_records(p.parse_event(ev, other=["total_rounds_played"]))

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
