"""
One-shot: download missing map radars + generate heatmaps for all matches.
Run from the project root:  python3 generate_all_heatmaps.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "backend"))

from heatmap_match import MAP_CONFIGS, RADAR_CACHE, _fetch_radar, generate_match_heatmap

DATA_DIR     = Path("backend/data")
FRONTEND_DIR = Path("frontend")

# ── 1. Download all missing radars ────────────────────────────────────────────
print("=== Radars ===")
for map_name in sorted(MAP_CONFIGS):
    dst = RADAR_CACHE / f"{map_name}_radar.jpg"
    if dst.exists():
        print(f"  [cached]  {map_name}")
    else:
        print(f"  [download] {map_name} ...", end=" ", flush=True)
        try:
            _fetch_radar(map_name)
            print("ok")
        except Exception as e:
            print(f"FAILED: {e}")

# ── 2. Generate heatmaps for all matches ──────────────────────────────────────
print("\n=== Heatmaps ===")
json_files = sorted(DATA_DIR.glob("*.json.gz"),
                    key=lambda p: int(p.stem.split(".")[0]))

ok = skipped = failed = unsupported = 0

for f in json_files:
    match_id = int(f.stem.split(".")[0])
    out      = FRONTEND_DIR / "heatmaps" / f"{match_id}.html"

    if out.exists():
        print(f"  [{match_id:>3}] already exists — skip")
        skipped += 1
        continue

    print(f"  [{match_id:>3}] generating ...", end=" ", flush=True)
    try:
        result = generate_match_heatmap(match_id, DATA_DIR, FRONTEND_DIR)
        if result is None:
            print("skipped (unsupported map)")
            unsupported += 1
        else:
            size = result.stat().st_size // 1024
            print(f"ok ({size} KB)")
            ok += 1
    except Exception as e:
        print(f"FAILED: {e}")
        failed += 1

print(f"\nDone: {ok} generated, {skipped} skipped, {unsupported} unsupported, {failed} failed")
