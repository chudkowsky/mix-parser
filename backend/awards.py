from __future__ import annotations

AWARD_DEFS: list[dict] = [
    {
        "type":    "season_mvp",
        "label":   "👑 MVP Sezonu",
        "min_matches": 3,
        "getter":  lambda p: p.get("avg_rating") or 0,
        "flavor":  lambda p, v: f"Dominował na serwerze z oceną {v:.2f}. Punkt odniesienia, do którego wszyscy się porównywali.",
    },
    {
        "type":    "top_fragger",
        "label":   "🔫 Top Fragger",
        "min_matches": 2,
        "getter":  lambda p: (p["total_kills"] / p["total_rounds"]) if p.get("total_rounds") else 0,
        "flavor":  lambda p, v: f"{p['total_kills']} zabójstw {v:.2f} na rundę. Przeciwnicy bali się każdego peeka.",
    },
    {
        "type":    "entry_king",
        "label":   "🚪 Krol Entry",
        "min_matches": 2,
        "min_field": "total_opening_attempts",
        "min_field_val": 8,
        "getter":  lambda p: (p["total_opening_kills"] / p["total_opening_attempts"]) if p.get("total_opening_attempts", 0) >= 8 else 0,
        "flavor":  lambda p, v: f"Wygrał {round(v * 100)}% wejść. Pierwszy wbija na scenę i ostatni z niej schodzi.",
    },
    {
        "type":    "clutch_master",
        "label":   "🧊 Stalowe Nerwy",
        "min_matches": 2,
        "min_field": "total_clutch_total",
        "min_field_val": 3,
        "getter":  lambda p: (p["total_clutch_won"] / p["total_clutch_total"]) if p.get("total_clutch_total", 0) >= 3 else 0,
        "flavor":  lambda p, v: f"{p['total_clutch_won']}/{p['total_clutch_total']} clutchy wygranych. Nerwy ze stali w kluczowych momentach.",
    },
    {
        "type":    "headshot_machine",
        "label":   "🎯 Maszyna do headów",
        "min_matches": 3,
        "getter":  lambda p: p.get("avg_hs_pct") or 0,
        "flavor":  lambda p, v: f"{v:.0f}% strzałów w głowę. Gardzi strzelaniem w klatę.",
    },
    {
        "type":    "flash_god",
        "label":   "⚡ Bóg Flashy",
        "min_matches": 2,
        "min_val": 1,
        "getter":  lambda p: p.get("total_flash_enemies") or 0,
        "flavor":  lambda p, v: f"Oślepił {int(v)} wrogów w tym sezonie. Flashował swoich częściej niż wrogów.",
    },
    {
        "type":    "survivalist",
        "label":   "🐢 Cykor",
        "min_matches": 3,
        "getter":  lambda p: p.get("avg_survive_pct") or 0,
        "flavor":  lambda p, v: f"Mistrz chowania się po kątach — przetrwał {v:.0f}% rund. Wyjdzie z nory dopiero, gdy wszyscy inni zginą.",
    },
    {
        "type":    "knife_lord",
        "label":   "🔪 Po krakowsku",
        "min_matches": 1,
        "min_val": 1,
        "getter":  lambda p: p.get("total_knife_kills") or 0,
        "flavor":  lambda p, v: f"{int(v)} zabójstw nożem. Czysta, zimna krew i brak szacunku dla przeciwnika.",
    },
    {
        "type":    "zeus_enjoyer",
        "label":   "⚡ Miłośnik Zeusa",
        "min_matches": 1,
        "min_val": 1,
        "getter":  lambda p: p.get("total_zeus_kills") or 0,
        "flavor":  lambda p, v: f"{int(v)} zabójstw tazerem w tym sezonie. Zaangażowany w ideę i nigdy się nie wycofał.",
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
