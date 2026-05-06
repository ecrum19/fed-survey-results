import os
import csv
import json
import re
import shutil
from collections import defaultdict

# Keep plotting fully headless and use writable cache paths in sandboxed envs.
os.environ.setdefault("MPLBACKEND", "Agg")
os.environ.setdefault("MPLCONFIGDIR", "/tmp/mplconfig")
os.environ.setdefault("XDG_CACHE_HOME", "/tmp")
os.makedirs(os.environ["MPLCONFIGDIR"], exist_ok=True)

import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DOCS_ASSETS_DIR = os.path.join(REPO_ROOT, "docs", "assets")
STAT_PATH = os.path.join(SCRIPT_DIR, "stat.json")
SIB_QUERIES_PATH = os.path.join(SCRIPT_DIR, "SIB_queries.csv")
PNG_OUTPUT = os.path.join(SCRIPT_DIR, "Queries_Summary_Figure.png")
HTML_OUTPUT = os.path.join(SCRIPT_DIR, "Queries_Summary_Figure_interactive.html")
HTML_DASHBOARD_OUTPUT = os.path.join(DOCS_ASSETS_DIR, "Queries_Summary_Figure_interactive.html")

# Slightly condensed paper figure height so it consumes less vertical space.
PAPER_FIG_HEIGHT = 8.4

BASE_URL_MAP = {
    "https://sparql.uniprot.org": "UniProt",
    "https://sparql.rhea-db.org": "Rhea",
    "https://sparql.swisslipids.org": "SwissLipids",
    "https://sparql.orthodb.org": "OrthoDB",
    "https://www.bgee.org/sparql": "Bgee",
    "https://sparql.omabrowser.org": "OMA",
    "https://biosoda.unil.ch/emi/sparql": "DGBI",
    "https://purl.org/emi#examples": "DGBI",
}


def normalize_query_stem(raw_name):
    """Normalize query names the same way dashboard processing does."""
    if raw_name is None:
        return None
    stem = str(raw_name).strip()
    if not stem:
        return None
    stem = re.sub(r"\.rq$", "", stem, flags=re.IGNORECASE)
    stem = re.sub(r"_ns$", "", stem, flags=re.IGNORECASE)
    stem = re.sub(r"_ws$", "", stem, flags=re.IGNORECASE)
    return stem or None


def extract_query_tail(query_reference):
    """
    Convert a URL-like query reference to its tail component.
    Examples:
      .../92_uniprot_bioregistry_iri_translation -> 92_uniprot_bioregistry_iri_translation
      ...#examples016 -> examples016
    """
    if query_reference is None:
        return None
    text = str(query_reference).strip()
    if not text or text == "-":
        return None
    tail = text.split("/")[-1]
    if "#" in tail:
        tail = tail.split("#")[-1]
    return tail.strip() or None


def build_query_alias_map(csv_path):
    """
    Build {query_stem -> alias} using SIB_queries.csv.
    Keeps only explicit aliases (not '-' / blank).
    """
    try:
        handle = open(csv_path, "r", encoding="utf-8", newline="")
    except FileNotFoundError:
        return {}

    alias_map = {}
    with handle:
        reader = csv.DictReader(handle)
        for row in reader:
            query_ref = row.get("Query", "")
            alias = str(row.get("Query alias", "")).strip()
            if not alias or alias == "-":
                continue
            tail = extract_query_tail(query_ref)
            stem = normalize_query_stem(tail)
            if stem and stem not in alias_map:
                alias_map[stem] = alias
    return alias_map


def abbreviate_query_name(query_url):
    """
    Convert a query URL to a compact label.
    """
    for base_url, abbr in BASE_URL_MAP.items():
        if query_url.startswith(base_url):
            val = query_url.split("/")[-1]
            if "#" in val:
                val = val.split("#")[-1]
            emi_match = re.match(r"^examples(\d+)([a-zA-Z]*)$", val)
            if abbr == "DGBI" and emi_match:
                val = f"E{emi_match.group(1)}{emi_match.group(2)}"
            elif "_" in val and val.split("_")[0].isdigit():
                val = f"{val.split('_')[0]}..."
            elif re.match(r"^[a-zA-Z]+\d+$", val):
                match = re.match(r"^([a-zA-Z]+)(\d+)$", val)
                if match:
                    val = f"E{match.group(2)}"
            elif re.match(r"^(\d{3})-.*$", val):
                match = re.match(r"^(\d{3})-.*$", val)
                if match:
                    val = match.group(1)
            elif re.match(r"^(\d+)-.*$", val):
                match = re.match(r"^(\d+)-.*$", val)
                if match:
                    val = f"{match.group(1)}..."
            return f"{abbr}-{val}"
    val = query_url.split("/")[-1]
    emi_match = re.match(r"^examples(\d+)([a-zA-Z]*)$", val)
    if emi_match:
        val = f"E{emi_match.group(1)}{emi_match.group(2)}"
    elif "_" in val and val.split("_")[0].isdigit():
        val = f"{val.split('_')[0]}..."
    elif re.match(r"^[a-zA-Z]+\d+$", val):
        match = re.match(r"^([a-zA-Z]+)(\d+)$", val)
        if match:
            val = f"E{match.group(2)}"
    elif re.match(r"^(\d{3})-.*$", val):
        match = re.match(r"^(\d{3})-.*$", val)
        if match:
            val = match.group(1)
    elif re.match(r"^(\d+)-.*$", val):
        match = re.match(r"^(\d+)-.*$", val)
        if match:
            val = f"{match.group(1)}..."
    return val


def load_query_data(stat_path, sib_queries_path):
    with open(stat_path, "r", encoding="utf-8") as handle:
        stat = json.load(handle)

    alias_map = build_query_alias_map(sib_queries_path)
    query_data = []

    for query_url, values in stat.get("data", {}).items():
        needed = (
            "number_recursive_property_path",
            "number_triple_patterns",
            "number_federation_member",
            "number_optional",
            "number_union",
        )
        if not all(key in values for key in needed):
            continue

        query_tail = extract_query_tail(query_url)
        query_stem = normalize_query_stem(query_tail)
        alias = alias_map.get(query_stem) if query_stem else None
        display_name = alias if alias else (query_stem if query_stem else query_url)

        query_data.append(
            {
                "query": query_url,
                "query_stem": query_stem,
                "display_name": display_name,
                "number_triple_patterns": values["number_triple_patterns"],
                "number_recursive_property_path": values["number_recursive_property_path"],
                "number_federation_member": values["number_federation_member"],
                "number_optional": values["number_optional"],
                "number_union": values["number_union"],
                "abbr_query": abbreviate_query_name(query_url),
            }
        )

    return sorted(query_data, key=lambda item: item["number_triple_patterns"])


def build_layout(query_data):
    """
    Compute shared bar positions/layout so static and interactive views stay consistent.
    """
    all_fed_members = sorted(set(item["number_federation_member"] for item in query_data))
    fed_cmap = plt.colormaps.get_cmap("tab10")
    fed_color_map = {fm: fed_cmap(i) for i, fm in enumerate(all_fed_members)}

    grouped = defaultdict(list)
    for item in query_data:
        grouped[item["number_federation_member"]].append(item)

    sorted_fed_members = sorted(grouped.keys())
    bar_width = 0.12
    bar_gap = 0.3
    side_gap = 0.3
    current_x = side_gap

    bars = []
    for group_index, fed_member in enumerate(sorted_fed_members):
        group = sorted(grouped[fed_member], key=lambda item: item["number_triple_patterns"])
        for item in group:
            bars.append(
                {
                    "x": current_x,
                    "height": item["number_triple_patterns"],
                    "fed_member": fed_member,
                    "color": fed_color_map[fed_member],
                    "label": item["display_name"],
                    "abbr_label": item["abbr_query"],
                    "query": item["query"],
                    "query_stem": item["query_stem"],
                    "optional": item["number_optional"],
                    "union": item["number_union"],
                }
            )
            current_x += bar_width
        if group_index < len(sorted_fed_members) - 1:
            current_x += bar_gap

    return {
        "bars": bars,
        "bar_width": bar_width,
        "side_gap": side_gap,
        "fed_member_values": all_fed_members,
        "fed_color_map": fed_color_map,
    }


def plot_static(layout, output_path):
    bars = layout["bars"]
    bar_width = layout["bar_width"]
    side_gap = layout["side_gap"]
    fed_member_values = layout["fed_member_values"]
    fed_color_map = layout["fed_color_map"]

    if not bars:
        raise RuntimeError("No bars available to plot.")

    min_width = 7.5
    per_query_width = 0.38
    fig_width = max(min_width, len(bars) * per_query_width)
    fig, ax = plt.subplots(figsize=(fig_width, PAPER_FIG_HEIGHT))

    x_positions = [item["x"] for item in bars]
    heights = [item["height"] for item in bars]
    colors = [item["color"] for item in bars]
    labels = [item["label"] for item in bars]
    rectangles = ax.bar(x_positions, heights, color=colors, width=bar_width, edgecolor="grey")

    hatch_pattern = "///"
    for index, rect in enumerate(rectangles):
        bar = bars[index]
        if bar["fed_member"] == 3:
            rect.set_hatch(hatch_pattern)

        symbol_offset = max(0.01 * rect.get_height(), 0.1)
        if bar["optional"] >= 1:
            ax.text(
                rect.get_x() + rect.get_width() / 2,
                rect.get_height() + symbol_offset,
                "O",
                ha="center",
                va="bottom",
                fontsize=14,
                color="black",
                fontweight="bold",
                family="monospace",
            )
        if bar["union"] >= 1:
            ax.text(
                rect.get_x() + rect.get_width() / 2,
                rect.get_height() + symbol_offset,
                "U",
                ha="center",
                va="bottom",
                fontsize=14,
                color="black",
                fontweight="bold",
                family="monospace",
            )

    ax.set_xticks(x_positions)
    ax.set_xticklabels(labels, fontsize=9, rotation=45, ha="right")
    ax.set_xlim(min(x_positions) - side_gap, max(x_positions) + side_gap)
    ax.set_ylim(0, max(heights) + 1.6)

    ax.set_title("SPARQL Query Complexity (Grouped by Federation Members)", fontsize=18, fontweight="bold")
    ax.set_xlabel("Query Name", fontsize=14, fontweight="bold")
    ax.set_ylabel("Number of Triple Patterns", fontsize=14, fontweight="bold")
    ax.tick_params(axis="y", labelsize=12, width=1.2)
    ax.yaxis.grid(True, linestyle="--", linewidth=0.8, alpha=0.7, zorder=0)
    ax.set_axisbelow(True)

    member_handles = []
    for fed_member in fed_member_values:
        if fed_member == 3:
            member_handles.append(
                mpl.patches.Patch(
                    facecolor=fed_color_map[fed_member],
                    edgecolor="grey",
                    label=f"Federation Members: {fed_member}",
                    hatch=hatch_pattern,
                )
            )
        else:
            member_handles.append(
                mpl.patches.Patch(
                    facecolor=fed_color_map[fed_member],
                    edgecolor="grey",
                    label=f"Federation Members: {fed_member}",
                    hatch="",
                )
            )

    legend1 = ax.legend(
        handles=member_handles,
        title="Number of Federation Members",
        loc="upper left",
        bbox_to_anchor=(0.01, 0.99),
        fontsize=12,
        title_fontsize=17,
        borderpad=0.8,
        labelspacing=0.7,
        handletextpad=0.7,
        alignment="left",
    )

    symbol_handles = [
        Line2D(
            [0],
            [0],
            marker="$O$",
            color="w",
            label="Contains OPTIONAL",
            markerfacecolor="black",
            markersize=10,
            linestyle="None",
            markeredgecolor="black",
            markeredgewidth=1,
        ),
        Line2D(
            [0],
            [0],
            marker="$U$",
            color="w",
            label="Contains UNION",
            markerfacecolor="black",
            markersize=10,
            linestyle="None",
            markeredgecolor="black",
            markeredgewidth=1,
        ),
    ]
    legend2 = ax.legend(
        handles=symbol_handles,
        title="Query Features",
        loc="upper left",
        bbox_to_anchor=(0.21, 0.99),
        fontsize=12,
        title_fontsize=17,
        borderpad=0.8,
        labelspacing=0.7,
        handletextpad=0.7,
        alignment="left",
    )
    legend1.get_title().set_fontweight("bold")
    legend2.get_title().set_fontweight("bold")
    ax.add_artist(legend1)
    ax.add_artist(legend2)

    plt.tight_layout()
    plt.savefig(output_path, dpi=220)
    plt.close(fig)


def rgba_to_hex(color):
    """Convert matplotlib RGBA tuple to hex."""
    r, g, b = [int(round(channel * 255)) for channel in color[:3]]
    return f"#{r:02x}{g:02x}{b:02x}"


def build_interactive_html(layout, output_path):
    """
    Create a standalone interactive HTML view without external JS dependencies.
    """
    bars = layout["bars"]
    if not bars:
        raise RuntimeError("No bars available to render interactively.")

    bar_payload = []
    for item in bars:
        bar_payload.append(
            {
                "x": item["x"],
                "height": item["height"],
                "fed_member": item["fed_member"],
                "color_hex": rgba_to_hex(item["color"]),
                "label": item["label"],
                "abbr_label": item["abbr_label"],
                "query": item["query"],
                "query_stem": item["query_stem"],
                "optional": item["optional"],
                "union": item["union"],
            }
        )

    json_payload = json.dumps(
        {
            "bars": bar_payload,
            "bar_width": layout["bar_width"],
            "side_gap": layout["side_gap"],
        }
    )

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Interactive SPARQL Query Complexity</title>
  <style>
    :root {{
      --bg: #f6f8fb;
      --panel: #ffffff;
      --line: #d8e0ea;
      --text: #1f2a36;
      --muted: #56718a;
    }}
    body {{
      margin: 0;
      font-family: "Source Sans 3", "Segoe UI", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 14px;
    }}
    .panel {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px 12px;
      box-shadow: 0 1px 6px rgba(18, 38, 61, 0.05);
    }}
    .title {{
      margin: 0 0 8px;
      font-size: 1.45rem;
      font-weight: 800;
      text-align: center;
      letter-spacing: 0.01em;
    }}
    .legend-row {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 0 0 8px;
    }}
    .legend-box {{
      border: 1px solid #ccd8e6;
      border-radius: 8px;
      background: #f8fbff;
      padding: 8px 10px;
      min-width: 240px;
    }}
    .legend-title {{
      margin: 0 0 6px;
      font-size: 1rem;
      font-weight: 800;
    }}
    .legend-item {{
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.95rem;
      color: #2b445c;
      margin: 4px 0;
    }}
    .legend-swatch {{
      width: 24px;
      height: 12px;
      border: 1px solid #667d95;
      box-sizing: border-box;
      display: inline-block;
      border-radius: 2px;
    }}
    .plot-wrap {{
      overflow-x: auto;
      border: 1px solid #ced9e6;
      border-radius: 8px;
      background: #ffffff;
      position: relative;
    }}
    svg {{
      display: block;
      min-height: 420px;
    }}
    .axis-label {{
      fill: #20384f;
      font-size: 20px;
      font-weight: 700;
    }}
    .tick-label {{
      fill: #4a637b;
      font-size: 12px;
    }}
    .y-tick {{
      fill: #4a637b;
      font-size: 14px;
      font-weight: 600;
    }}
    .grid-line {{
      stroke: #d9e3ef;
      stroke-width: 1;
      stroke-dasharray: 5 4;
    }}
    .bar {{
      cursor: pointer;
      transition: opacity 90ms linear;
    }}
    .bar:hover {{
      opacity: 0.82;
      stroke: #1d2c3b;
      stroke-width: 1.1;
    }}
    .symbol {{
      font-size: 16px;
      font-weight: 800;
      fill: #0f1720;
      text-anchor: middle;
      font-family: "Courier New", monospace;
      pointer-events: none;
    }}
    .x-label {{
      fill: #4d6980;
      font-size: 12px;
      text-anchor: end;
    }}
    .tooltip {{
      position: fixed;
      pointer-events: none;
      z-index: 99;
      border: 1px solid #9db9d3;
      background: rgba(255, 255, 255, 0.98);
      border-radius: 8px;
      padding: 8px 10px;
      box-shadow: 0 8px 24px rgba(24, 45, 70, 0.15);
      font-size: 13px;
      min-width: 250px;
      max-width: 420px;
      display: none;
      white-space: normal;
      color: #13293d;
    }}
    .tooltip .head {{
      font-weight: 800;
      margin-bottom: 6px;
      color: #173a59;
    }}
    .foot {{
      margin-top: 8px;
      color: var(--muted);
      font-size: 0.92rem;
    }}
  </style>
</head>
<body>
  <div class="panel">
    <h1 class="title">SPARQL Query Complexity (Grouped by Federation Members)</h1>
    <div class="legend-row">
      <div class="legend-box">
        <p class="legend-title">Number of Federation Members</p>
        <div class="legend-item"><span class="legend-swatch" id="fm2Swatch"></span>Federation Members: 2</div>
        <div class="legend-item"><span class="legend-swatch" id="fm3Swatch"></span>Federation Members: 3 (hatched)</div>
      </div>
      <div class="legend-box">
        <p class="legend-title">Query Features</p>
        <div class="legend-item"><strong style="font-family: monospace;">O</strong>Contains OPTIONAL</div>
        <div class="legend-item"><strong style="font-family: monospace;">U</strong>Contains UNION</div>
      </div>
    </div>
    <div class="plot-wrap">
      <svg id="chart" role="img" aria-label="Interactive SPARQL query complexity chart"></svg>
    </div>
    <p class="foot">Hover bars for detailed query metadata. Scroll horizontally if needed.</p>
  </div>
  <div class="tooltip" id="tooltip"></div>

  <script>
    const data = {json_payload};
    const svg = document.getElementById("chart");
    const tooltip = document.getElementById("tooltip");
    const bars = data.bars;
    const margin = {{ top: 20, right: 16, bottom: 165, left: 72 }};
    const rowHeight = 11.5;
    const pxPerBar = 22;
    const width = Math.max(1500, margin.left + margin.right + (bars.length * pxPerBar));
    const height = 620;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maxY = Math.max(...bars.map((b) => Number(b.height || 0)), 0) + 2;

    svg.setAttribute("viewBox", `0 0 ${{width}} ${{height}}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
      <pattern id="diagHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="transparent"></rect>
        <line x1="0" y1="0" x2="0" y2="8" stroke="#6b7a8a" stroke-width="2"></line>
      </pattern>
      <mask id="hatchMask">
        <rect x="0" y="0" width="100%" height="100%" fill="white"></rect>
      </mask>
    `;
    svg.appendChild(defs);

    function xScale(value) {{
      const minX = Math.min(...bars.map((b) => b.x)) - data.side_gap;
      const maxX = Math.max(...bars.map((b) => b.x)) + data.side_gap;
      return margin.left + ((value - minX) / (maxX - minX)) * innerWidth;
    }}

    function yScale(value) {{
      return margin.top + innerHeight - (value / maxY) * innerHeight;
    }}

    function createSvg(tag, attrs = {{}}) {{
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.entries(attrs).forEach(([key, val]) => node.setAttribute(key, String(val)));
      return node;
    }}

    // Y-grid and axis labels.
    for (let tick = 0; tick <= maxY; tick += 5) {{
      const y = yScale(tick);
      const grid = createSvg("line", {{
        x1: margin.left,
        x2: width - margin.right,
        y1: y,
        y2: y,
        class: "grid-line",
      }});
      svg.appendChild(grid);

      const tickText = createSvg("text", {{
        x: margin.left - 12,
        y: y + 5,
        class: "y-tick",
        "text-anchor": "end",
      }});
      tickText.textContent = String(tick);
      svg.appendChild(tickText);
    }}

    const yAxis = createSvg("line", {{
      x1: margin.left,
      x2: margin.left,
      y1: margin.top,
      y2: margin.top + innerHeight,
      stroke: "#4f6d88",
      "stroke-width": 1.2,
    }});
    svg.appendChild(yAxis);

    const xAxis = createSvg("line", {{
      x1: margin.left,
      x2: width - margin.right,
      y1: margin.top + innerHeight,
      y2: margin.top + innerHeight,
      stroke: "#4f6d88",
      "stroke-width": 1.2,
    }});
    svg.appendChild(xAxis);

    const yLabel = createSvg("text", {{
      x: 24,
      y: margin.top + innerHeight / 2,
      transform: `rotate(-90 24 ${{margin.top + innerHeight / 2}})`,
      class: "axis-label",
    }});
    yLabel.textContent = "Number of Triple Patterns";
    svg.appendChild(yLabel);

    const xLabel = createSvg("text", {{
      x: margin.left + innerWidth / 2,
      y: height - 22,
      class: "axis-label",
      "text-anchor": "middle",
    }});
    xLabel.textContent = "Query Name";
    svg.appendChild(xLabel);

    const barPixelWidth = Math.max(6, Math.min(18, innerWidth / (bars.length + 8)));

    bars.forEach((bar) => {{
      const xCenter = xScale(bar.x);
      const barHeight = yScale(0) - yScale(bar.height);
      const rectY = yScale(bar.height);
      const rectX = xCenter - barPixelWidth / 2;

      const baseRect = createSvg("rect", {{
        x: rectX,
        y: rectY,
        width: barPixelWidth,
        height: barHeight,
        fill: bar.color_hex,
        class: "bar",
      }});

      const tooltipHtml = [
        `<div class="head">${{bar.label}}</div>`,
        `<div><strong>Triple patterns:</strong> ${{bar.height}}</div>`,
        `<div><strong>Federation members:</strong> ${{bar.fed_member}}</div>`,
        `<div><strong>Contains OPTIONAL:</strong> ${{bar.optional >= 1 ? "Yes" : "No"}}</div>`,
        `<div><strong>Contains UNION:</strong> ${{bar.union >= 1 ? "Yes" : "No"}}</div>`,
        `<div><strong>Source query:</strong> <span style="word-break: break-all;">${{bar.query}}</span></div>`,
      ].join("");

      baseRect.addEventListener("mousemove", (event) => {{
        tooltip.style.display = "block";
        tooltip.innerHTML = tooltipHtml;
        const offset = 16;
        let left = event.clientX + offset;
        let top = event.clientY + offset;
        if (left + tooltip.offsetWidth > window.innerWidth - 8) {{
          left = event.clientX - tooltip.offsetWidth - offset;
        }}
        if (top + tooltip.offsetHeight > window.innerHeight - 8) {{
          top = event.clientY - tooltip.offsetHeight - offset;
        }}
        tooltip.style.left = `${{left}}px`;
        tooltip.style.top = `${{top}}px`;
      }});
      baseRect.addEventListener("mouseleave", () => {{
        tooltip.style.display = "none";
      }});
      svg.appendChild(baseRect);

      if (bar.fed_member === 3) {{
        const hatchRect = createSvg("rect", {{
          x: rectX,
          y: rectY,
          width: barPixelWidth,
          height: barHeight,
          fill: "url(#diagHatch)",
          opacity: 0.7,
          pointerEvents: "none",
        }});
        svg.appendChild(hatchRect);
      }}

      if (bar.optional >= 1) {{
        const text = createSvg("text", {{
          x: xCenter,
          y: rectY - 3,
          class: "symbol",
        }});
        text.textContent = "O";
        svg.appendChild(text);
      }}
      if (bar.union >= 1) {{
        const text = createSvg("text", {{
          x: xCenter,
          y: rectY - 3,
          class: "symbol",
        }});
        text.textContent = "U";
        svg.appendChild(text);
      }}

      const label = createSvg("text", {{
        x: xCenter - 2,
        y: margin.top + innerHeight + 10,
        class: "x-label",
        transform: `rotate(-45 ${{xCenter - 2}} ${{margin.top + innerHeight + 10}})`,
      }});
      label.textContent = bar.label;
      svg.appendChild(label);
    }});

    const fed2 = bars.find((b) => b.fed_member === 2);
    const fed3 = bars.find((b) => b.fed_member === 3);
    if (fed2) {{
      document.getElementById("fm2Swatch").style.background = fed2.color_hex;
    }}
    if (fed3) {{
      document.getElementById("fm3Swatch").style.background = fed3.color_hex;
      document.getElementById("fm3Swatch").style.backgroundImage = "repeating-linear-gradient(45deg, rgba(80,80,80,.45) 0 2px, transparent 2px 5px)";
    }}
  </script>
</body>
</html>
"""

    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write(html)


def main():
    query_data = load_query_data(STAT_PATH, SIB_QUERIES_PATH)
    layout = build_layout(query_data)
    plot_static(layout, PNG_OUTPUT)
    build_interactive_html(layout, HTML_OUTPUT)
    os.makedirs(DOCS_ASSETS_DIR, exist_ok=True)
    shutil.copyfile(HTML_OUTPUT, HTML_DASHBOARD_OUTPUT)
    print(f"[OK] Wrote static figure: {PNG_OUTPUT}")
    print(f"[OK] Wrote interactive figure: {HTML_OUTPUT}")
    print(f"[OK] Copied interactive figure for dashboard: {HTML_DASHBOARD_OUTPUT}")


if __name__ == "__main__":
    main()
