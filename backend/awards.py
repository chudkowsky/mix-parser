from __future__ import annotations

AWARD_DEFS: list[dict] = [
    {
        "type":    "season_mvp",
        "label":   "👑 Season MVP",
        "min_matches": 3,
        "getter":  lambda p: p.get("avg_rating") or 0,
        "flavor":  lambda p, v: f"Led the server with a {v:.2f} average rating. The undisputed benchmark everyone measured themselves against.",
    },
    {
        "type":    "top_fragger",
        "label":   "🔫 Top Fragger",
        "min_matches": 2,
        "getter":  lambda p: (p["total_kills"] / p["total_rounds"]) if p.get("total_rounds") else 0,
        "flavor":  lambda p, v: f"{p['total_kills']} kills at {v:.2f} per round. Enemies feared the peek.",
    },
    {
        "type":    "entry_king",
        "label":   "🚪 Entry King",
        "min_matches": 2,
        "min_field": "total_opening_attempts",
        "min_field_val": 8,
        "getter":  lambda p: (p["total_opening_kills"] / p["total_opening_attempts"]) if p.get("total_opening_attempts", 0) >= 8 else 0,
        "flavor":  lambda p, v: f"Won {round(v * 100)}% of opening duels. First through the door, last man standing.",
    },
    {
        "type":    "clutch_master",
        "label":   "🧊 Ice Veins",
        "min_matches": 2,
        "min_field": "total_clutch_total",
        "min_field_val": 3,
        "getter":  lambda p: (p["total_clutch_won"] / p["total_clutch_total"]) if p.get("total_clutch_total", 0) >= 3 else 0,
        "flavor":  lambda p, v: f"{p['total_clutch_won']}/{p['total_clutch_total']} clutches won. Nerves of steel when it mattered most.",
    },
    {
        "type":    "headshot_machine",
        "label":   "🎯 Headshot Machine",
        "min_matches": 3,
        "getter":  lambda p: p.get("avg_hs_pct") or 0,
        "flavor":  lambda p, v: f"{v:.0f}% headshot rate. No body shots — ever.",
    },
    {
        "type":    "flash_god",
        "label":   "⚡ Flash God",
        "min_matches": 2,
        "min_val": 1,
        "getter":  lambda p: p.get("total_flash_enemies") or 0,
        "flavor":  lambda p, v: f"Blinded {int(v)} enemies this season. Teammates may have suffered collateral damage.",
    },
    {
        "type":    "survivalist",
        "label":   "🐢 Survivalist",
        "min_matches": 3,
        "getter":  lambda p: p.get("avg_survive_pct") or 0,
        "flavor":  lambda p, v: f"Survived {v:.0f}% of rounds. Death had trouble finding this player.",
    },
    {
        "type":    "knife_lord",
        "label":   "🔪 Knife Lord",
        "min_matches": 1,
        "min_val": 1,
        "getter":  lambda p: p.get("total_knife_kills") or 0,
        "flavor":  lambda p, v: f"{int(v)} knife kills. Pure, cold-blooded disrespect.",
    },
    {
        "type":    "zeus_enjoyer",
        "label":   "⚡ Zeus Enjoyer",
        "min_matches": 1,
        "min_val": 1,
        "getter":  lambda p: p.get("total_zeus_kills") or 0,
        "flavor":  lambda p, v: f"{int(v)} taser kills this season. Committed to the bit and never looked back.",
    },
]


def generate_season_awards(all_players: list[dict], season_id: int) -> list[dict]:
    awards: list[dict] = []

    for defn in AWARD_DEFS:
        min_matches  = defn.get("min_matches", 1)
        min_val      = defn.get("min_val", 0)
        min_field    = defn.get("min_field")
        min_field_val = defn.get("min_field_val", 0)

        eligible = [
            p for p in all_players
            if p.get("matches_played", 0) >= min_matches
            and (min_field is None or p.get(min_field, 0) >= min_field_val)
        ]
        if not eligible:
            continue

        scored = [(p, defn["getter"](p)) for p in eligible]
        scored = [(p, v) for p, v in scored if v > min_val]
        if not scored:
            continue

        winner, val = max(scored, key=lambda x: x[1])

        stat_str = f"{val:.2f}" if isinstance(val, float) else str(int(val))
        awards.append({
            "season_id":   season_id,
            "steamid":     winner["steamid"],
            "award_type":  defn["type"],
            "award_label": defn["label"],
            "flavor_text": defn["flavor"](winner, val),
            "stat_value":  stat_str,
        })

    return awards
