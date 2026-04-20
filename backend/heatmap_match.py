"""
Generates a per-match interactive heatmap HTML (all players, dropdown switcher).
Reads from already-parsed match JSON — no demo file needed.
Called as a background task after upload.
"""
import base64
import gzip
import json
import urllib.request
from pathlib import Path

import plotly.graph_objects as go

IMG_SIZE = 1024

MAP_CONFIGS = {
    "de_inferno":  {"pos_x": -2087, "pos_y": 3870,  "scale": 4.9},
    "de_mirage":   {"pos_x": -3230, "pos_y": 1713,  "scale": 5.0},
    "de_dust2":    {"pos_x": -2476, "pos_y": 3239,  "scale": 4.4},
    "de_overpass": {"pos_x": -4831, "pos_y": 1781,  "scale": 5.2},
    "de_nuke":     {"pos_x": -3453, "pos_y": 2887,  "scale": 7.0},
    "de_anubis":   {"pos_x": -2796, "pos_y": 3328,  "scale": 5.22},
    "de_ancient":  {"pos_x": -2953, "pos_y": 2164,  "scale": 5.0},
    "de_vertigo":  {"pos_x": -3168, "pos_y": 1762,  "scale": 4.0},
}

RADAR_CACHE = Path(__file__).parent / "data" / "radars"


def _fetch_radar(map_name: str) -> Path:
    RADAR_CACHE.mkdir(exist_ok=True)
    dst = RADAR_CACHE / f"{map_name}_radar.jpg"
    if not dst.exists():
        url = (
            "https://raw.githubusercontent.com/CSGO-Analysis/"
            f"csgo-maps-overviews/master/overviews/{map_name}_radar.jpg"
        )
        urllib.request.urlretrieve(url, dst)
    return dst


def _game_to_pixel(x, y, cfg):
    px = (x - cfg["pos_x"]) / cfg["scale"]
    py = (cfg["pos_y"] - y) / cfg["scale"]
    return px, IMG_SIZE - py   # flip Y for Plotly (bottom=0)


def generate_match_heatmap(match_id: int, data_dir: Path, frontend_dir: Path) -> Path | None:
    """
    Build one self-contained HTML for all players in a match.
    Returns path to written file, or None if map is unsupported.
    """
    json_path = data_dir / f"{match_id}.json.gz"
    if not json_path.exists():
        return None

    with gzip.open(json_path) as f:
        data = json.load(f)

    map_name = data.get("header", {}).get("map_name", "")
    cfg = MAP_CONFIGS.get(map_name)
    if cfg is None:
        return None

    kills_raw = data.get("kills", [])
    ratings   = data.get("ratings", [])
    players   = [r["name"] for r in ratings]  # sorted by rating desc

    if not players or not kills_raw:
        return None

    radar_path = _fetch_radar(map_name)
    with open(radar_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    # ── Per-player kill/death records ─────────────────────────────────────────
    def records_for(name):
        kills, deaths = [], []
        for k in kills_raw:
            atk      = k.get("attacker_name", "")
            vic      = k.get("user_name", "")
            atk_team = k.get("attacker_team_name", "")
            vic_team = k.get("user_team_name", "")
            weapon   = k.get("weapon", "?")
            hs       = bool(k.get("headshot", False))
            if atk_team == vic_team:
                continue
            if atk == name:
                ax, ay = k.get("attacker_X"), k.get("attacker_Y")
                vx, vy = k.get("user_X"),     k.get("user_Y")
                if None not in (ax, ay, vx, vy):
                    kills.append({
                        "atk": _game_to_pixel(ax, ay, cfg),
                        "vic": _game_to_pixel(vx, vy, cfg),
                        "victim": vic, "weapon": weapon, "hs": hs,
                    })
            if vic == name:
                ax, ay = k.get("attacker_X"), k.get("attacker_Y")
                vx, vy = k.get("user_X"),     k.get("user_Y")
                if None not in (ax, ay, vx, vy):
                    deaths.append({
                        "atk": _game_to_pixel(ax, ay, cfg),
                        "vic": _game_to_pixel(vx, vy, cfg),
                        "killer": atk, "weapon": weapon, "hs": hs,
                    })
        return kills, deaths

    # ── Build figure ──────────────────────────────────────────────────────────
    fig = go.Figure()

    fig.add_layout_image(dict(
        source=f"data:image/jpeg;base64,{img_b64}",
        x=0, y=0, xref="x", yref="y",
        sizex=IMG_SIZE, sizey=IMG_SIZE,
        xanchor="left", yanchor="bottom",
        layer="below", sizing="stretch", opacity=0.6,
    ))

    # 4 traces per player: kills, deaths, victim_dot, killer_dot
    TRACES_PER_PLAYER = 4
    all_player_data = {}   # name → {kills, deaths} for JS

    for i, name in enumerate(players):
        kills, deaths = records_for(name)
        all_player_data[name] = {
            "kills":  [{"atk": k["atk"], "vic": k["vic"],
                        "victim": k["victim"], "weapon": k["weapon"],
                        "hs": k["hs"]} for k in kills],
            "deaths": [{"atk": d["atk"], "vic": d["vic"],
                        "killer": d["killer"], "weapon": d["weapon"],
                        "hs": d["hs"]} for d in deaths],
        }
        visible = (i == 0)

        # trace 0: kill dots (green)
        fig.add_trace(go.Scatter(
            x=[k["atk"][0] for k in kills],
            y=[k["atk"][1] for k in kills],
            mode="markers", name=f"{name} – Kills",
            marker=dict(color="lime", size=13, line=dict(color="white", width=1)),
            customdata=[[k["vic"][0], k["vic"][1], k["victim"],
                         k["weapon"], "HS" if k["hs"] else ""] for k in kills],
            hovertemplate=(
                "<b>Killed:</b> %{customdata[2]}<br>"
                "<b>Weapon:</b> %{customdata[3]} %{customdata[4]}<br>"
                "<i>click → victim position</i><extra></extra>"
            ),
            visible=visible, showlegend=False,
        ))

        # trace 1: death dots (red)
        fig.add_trace(go.Scatter(
            x=[d["vic"][0] for d in deaths],
            y=[d["vic"][1] for d in deaths],
            mode="markers", name=f"{name} – Deaths",
            marker=dict(color="red", size=13, line=dict(color="white", width=1)),
            customdata=[[d["atk"][0], d["atk"][1], d["killer"],
                         d["weapon"], "HS" if d["hs"] else ""] for d in deaths],
            hovertemplate=(
                "<b>Killed by:</b> %{customdata[2]}<br>"
                "<b>Weapon:</b> %{customdata[3]} %{customdata[4]}<br>"
                "<i>click → killer position</i><extra></extra>"
            ),
            visible=visible, showlegend=False,
        ))

        # trace 2: victim indicator dot (cyan X, hidden until click)
        fig.add_trace(go.Scatter(
            x=[None], y=[None], mode="markers+text",
            name=f"{name} – Victim pos",
            marker=dict(color="cyan", size=18, symbol="x",
                        line=dict(color="white", width=2)),
            text=[""], textposition="top center",
            textfont=dict(color="cyan", size=11),
            hoverinfo="skip", visible=visible, showlegend=False,
        ))

        # trace 3: killer indicator dot (orange X, hidden until click)
        fig.add_trace(go.Scatter(
            x=[None], y=[None], mode="markers+text",
            name=f"{name} – Killer pos",
            marker=dict(color="orange", size=18, symbol="x",
                        line=dict(color="white", width=2)),
            text=[""], textposition="top center",
            textfont=dict(color="orange", size=11),
            hoverinfo="skip", visible=visible, showlegend=False,
        ))

    # ── Dropdown buttons ──────────────────────────────────────────────────────
    n = len(players)
    buttons = []
    for i, name in enumerate(players):
        visibility = [False] * (n * TRACES_PER_PLAYER)
        for t in range(TRACES_PER_PLAYER):
            visibility[i * TRACES_PER_PLAYER + t] = True
        buttons.append(dict(
            label=name,
            method="update",
            args=[
                {"visible": visibility},
                {"title": f"{name}  ·  {map_name}  ·  Kills & Deaths"},
            ],
        ))

    fig.update_layout(
        title=None,
        paper_bgcolor="#0d0d0d",
        plot_bgcolor="#0d0d0d",
        xaxis=dict(range=[0, IMG_SIZE], showgrid=False, zeroline=False,
                   showticklabels=False, scaleanchor="y", scaleratio=1),
        yaxis=dict(range=[0, IMG_SIZE], showgrid=False, zeroline=False,
                   showticklabels=False),
        margin=dict(l=10, r=10, t=10, b=10),
        width=920, height=920,
    )

    player_list_js = json.dumps(players)
    n_players_js   = len(players)
    click_js = f"""
<script>
(function() {{
    var players = {player_list_js};
    var N = {n_players_js};
    var TPP = {TRACES_PER_PLAYER};  // traces per player

    // ── Build toolbar ──────────────────────────────────────────────────────
    var wrap = document.getElementById('plotly-div').parentElement;
    var toolbar = document.createElement('div');
    toolbar.style.cssText = [
        'display:flex', 'align-items:center', 'gap:10px',
        'padding:10px 14px 6px', 'background:#0d0d0d',
    ].join(';');

    var label = document.createElement('span');
    label.textContent = 'Player';
    label.style.cssText = 'color:#888;font-size:13px;font-family:sans-serif;white-space:nowrap';

    var sel = document.createElement('select');
    sel.style.cssText = [
        'background:#1e1e2e', 'color:#e0e0e0', 'border:1px solid #444',
        'border-radius:6px', 'padding:6px 12px', 'font-size:14px',
        'font-family:sans-serif', 'cursor:pointer', 'outline:none',
        'min-width:180px',
    ].join(';');
    players.forEach(function(name, i) {{
        var opt = document.createElement('option');
        opt.value = i;
        opt.textContent = name;
        sel.appendChild(opt);
    }});

    var hint = document.createElement('span');
    hint.innerHTML = '<span style="color:lime">●</span> click kill &rarr; victim &nbsp;&nbsp;<span style="color:red">●</span> click death &rarr; killer &nbsp;&nbsp;<span style="color:#888">double-click &rarr; clear</span>';
    hint.style.cssText = 'color:#888;font-size:12px;font-family:sans-serif;margin-left:auto';

    toolbar.appendChild(label);
    toolbar.appendChild(sel);
    toolbar.appendChild(hint);
    wrap.insertBefore(toolbar, document.getElementById('plotly-div'));

    // ── Player switch ──────────────────────────────────────────────────────
    function showPlayer(pi) {{
        var gd = document.getElementById('plotly-div');
        var vis = [];
        for (var i = 0; i < N * TPP; i++) vis.push(false);
        for (var t = 0; t < TPP; t++) vis[pi * TPP + t] = true;
        Plotly.restyle(gd, {{ visible: vis }});
        // clear indicator dots
        Plotly.restyle(gd, {{ x: [[null]], y: [[null]], text: [['']] }}, [pi*TPP+2, pi*TPP+3]);
    }}

    sel.addEventListener('change', function() {{ showPlayer(parseInt(sel.value)); }});

    // ── Click handler ──────────────────────────────────────────────────────
    var gd = document.getElementById('plotly-div');

    gd.on('plotly_click', function(data) {{
        var pt   = data.points[0];
        var idx  = pt.fullData.index;
        var pi   = parseInt(sel.value);
        var base = pi * TPP;
        var cd   = pt.customdata;

        if (idx === base) {{           // kill dot → show victim (trace +2)
            Plotly.restyle(gd, {{
                x: [[cd[0]]], y: [[cd[1]]],
                text: [[cd[2] + '<br>' + cd[3] + (cd[4] ? ' HS' : '')]]
            }}, [base + 2]);
        }}
        if (idx === base + 1) {{       // death dot → show killer (trace +3)
            Plotly.restyle(gd, {{
                x: [[cd[0]]], y: [[cd[1]]],
                text: [[cd[2] + '<br>' + cd[3] + (cd[4] ? ' HS' : '')]]
            }}, [base + 3]);
        }}
    }});

    gd.on('plotly_doubleclick', function() {{
        var pi   = parseInt(sel.value);
        var base = pi * TPP;
        Plotly.restyle(gd, {{ x: [[null]], y: [[null]], text: [['']] }}, [base+2, base+3]);
        return false;
    }});
}})();
</script>
"""

    html = fig.to_html(full_html=True, div_id="plotly-div", include_plotlyjs=True)
    html = html.replace("</body>", click_js + "\n</body>")

    out_dir = frontend_dir / "heatmaps"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{match_id}.html"
    out.write_text(html)
    return out
