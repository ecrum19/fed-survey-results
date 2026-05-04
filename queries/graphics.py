import os
# Keep plotting fully headless and use writable cache paths in sandboxed envs.
os.environ.setdefault("MPLBACKEND", "Agg")
os.environ.setdefault("MPLCONFIGDIR", "/tmp/mplconfig")
os.environ.setdefault("XDG_CACHE_HOME", "/tmp")
os.makedirs(os.environ["MPLCONFIGDIR"], exist_ok=True)

import matplotlib.pyplot as plt
import json
from collections import defaultdict
import matplotlib as mpl
from matplotlib.lines import Line2D
import re
import csv

# Define the file path
file_path = 'stat.json'
sib_queries_path = 'SIB_queries.csv'

def replace_dots_with_commas(file_path):
    # Open the file in read mode
    with open(file_path, 'r') as file:
        # Read the content of the file
        content = file.read()
    
    # Replace all periods with commas
    updated_content = content.replace(',', '.')
    
    # Open the file in write mode to overwrite with updated content
    with open(file_path, 'w') as file:
        # Write the updated content to the file
        file.write(updated_content)

# Replace 'your_file.txt' with the path to your file
# replace_dots_with_commas(file_path)

# Load the JSON data
with open(file_path, 'r') as f:
    stat = json.load(f)


def normalize_query_stem(raw_name):
    """Normalize query names the same way dashboard processing does."""
    if raw_name is None:
        return None
    stem = str(raw_name).strip()
    if not stem:
        return None
    stem = re.sub(r'\.rq$', '', stem, flags=re.IGNORECASE)
    stem = re.sub(r'_ns$', '', stem, flags=re.IGNORECASE)
    stem = re.sub(r'_ws$', '', stem, flags=re.IGNORECASE)
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
    if not text or text == '-':
        return None
    tail = text.split('/')[-1]
    if '#' in tail:
        tail = tail.split('#')[-1]
    return tail.strip() or None


def build_query_alias_map(csv_path):
    """
    Build {query_stem -> alias} using SIB_queries.csv.
    Keeps only explicit aliases (not '-' / blank).
    """
    try:
        handle = open(csv_path, 'r', encoding='utf-8', newline='')
    except FileNotFoundError:
        return {}

    alias_map = {}
    with handle:
        reader = csv.DictReader(handle)
        for row in reader:
            query_ref = row.get('Query', '')
            alias = str(row.get('Query alias', '')).strip()
            if not alias or alias == '-':
                continue
            tail = extract_query_tail(query_ref)
            stem = normalize_query_stem(tail)
            if stem and stem not in alias_map:
                alias_map[stem] = alias
    return alias_map


query_alias_map = build_query_alias_map(sib_queries_path)

# Extract relevant fields for each query
query_data = []
for query, vals in stat['data'].items():
    if 'number_recursive_property_path' in vals and 'number_triple_patterns' in vals and 'number_federation_member' in vals:
        query_tail = extract_query_tail(query)
        query_stem = normalize_query_stem(query_tail)
        alias = query_alias_map.get(query_stem) if query_stem else None
        query_data.append({
            'query': query,
            'query_stem': query_stem,
            'display_name': alias if alias else (query_stem if query_stem else query),
            'number_triple_patterns': vals['number_triple_patterns'],
            'number_recursive_property_path': vals['number_recursive_property_path'],
            'number_federation_member': vals['number_federation_member'],
            'number_optional': vals['number_optional'],
            'number_union': vals['number_union']
        })

# Sort query_data by number_triple_patterns ascending
query_data = sorted(query_data, key=lambda x: x['number_triple_patterns'])

# Mapping from base URLs to abbreviations
BASE_URL_MAP = {
    'https://sparql.uniprot.org': 'UniProt',
    'https://sparql.rhea-db.org': 'Rhea',
    'https://sparql.swisslipids.org': 'SwissLipids',
    'https://sparql.orthodb.org': 'OrthoDB',
    'https://www.bgee.org/sparql': 'Bgee',
    'https://sparql.omabrowser.org': 'OMA',
    'https://biosoda.unil.ch/emi/sparql': 'DGBI',
    'https://purl.org/emi#examples': 'DGBI',
}

def abbreviate_query_name(query_url):
    """
    Convert a query URL to an abbreviated name like 'UniProt-45'.
    If the value after the last '/' is a number followed by text, abbreviate as 'Base-<number>...'.
    If the value is letters followed by a number (e.g., examples015), abbreviate as 'Base-E015'.
    If the value is a 3-digit number followed by a dash and text (e.g., 028-biosodafrontend), abbreviate as 'Base-028'.
    For EMI examples, abbreviate as 'DGBI-E<digits>' (e.g., 'https://purl.org/emi#examples012' -> 'DGBI-E012').
    """
    import re
    for base_url, abbr in BASE_URL_MAP.items():
        if query_url.startswith(base_url):
            val = query_url.split('/')[-1]
            # Handle fragment
            if '#' in val:
                val = val.split('#')[-1]
            # Special case for EMI examples: 'examples' + digits + optional letter(s) -> 'E<digits><letter(s)>'
            emi_match = re.match(r'^examples(\d+)([a-zA-Z]*)$', val)
            if abbr == 'DGBI' and emi_match:
                val = f"E{emi_match.group(1)}{emi_match.group(2)}"
            # If value is like '99_uniprot_identifiers_org_translation', abbreviate to '99...'
            elif '_' in val and val.split('_')[0].isdigit():
                val = f"{val.split('_')[0]}..."
            # If value is like 'examples015', abbreviate to 'E015'
            elif re.match(r'^[a-zA-Z]+\d+$', val):
                match = re.match(r'^([a-zA-Z]+)(\d+)$', val)
                if match:
                    val = f"E{match.group(2)}"
            # If value is like '028-biosodafrontend', abbreviate to '028'
            elif re.match(r'^(\d{3})-.*$', val):
                match = re.match(r'^(\d{3})-.*$', val)
                if match:
                    val = match.group(1)
            # If value is like '15-rat-TP53-biosodafrontend', abbreviate to '15...'
            elif re.match(r'^(\d+)-.*$', val):
                match = re.match(r'^(\d+)-.*$', val)
                if match:
                    val = f"{match.group(1)}..."
            return f"{abbr}-{val}"
    # If not matched, just return the last part, with same abbreviation logic
    val = query_url.split('/')[-1]
    emi_match = re.match(r'^examples(\d+)([a-zA-Z]*)$', val)
    if emi_match:
        val = f"E{emi_match.group(1)}{emi_match.group(2)}"
    elif '_' in val and val.split('_')[0].isdigit():
        val = f"{val.split('_')[0]}..."
    elif re.match(r'^[a-zA-Z]+\d+$', val):
        match = re.match(r'^([a-zA-Z]+)(\d+)$', val)
        if match:
            val = f"E{match.group(2)}"
    elif re.match(r'^(\d{3})-.*$', val):
        match = re.match(r'^(\d{3})-.*$', val)
        if match:
            val = match.group(1)
    elif re.match(r'^(\d+)-.*$', val):
        match = re.match(r'^(\d+)-.*$', val)
        if match:
            val = f"{match.group(1)}..."
    return val

# Prepare color mapping for number_federation_member
all_fed_members = sorted(set(q['number_federation_member'] for q in query_data))
fed_cmap = plt.colormaps.get_cmap('tab10')
fed_color_map = {fm: fed_cmap(i) for i, fm in enumerate(all_fed_members)}

# Group queries by number_federation_member
from collections import defaultdict
queries_by_fed_member = defaultdict(list)
for q in query_data:
    queries_by_fed_member[q['number_federation_member']].append(q)

# Sort the groups by federation member, and each group by number_triple_patterns ascending
sorted_fed_members = sorted(queries_by_fed_member.keys())
bar_positions = []
heights = []
bar_colors = []
query_labels = []
bar_queries = []
current_x = 0
bar_width = 0.12  # Even skinnier bars
bar_gap = 0.3    # Gap between groups
side_gap = 0.3   # Small gap at start and end

bar_positions = []
heights = []
bar_colors = []
query_labels = []
bar_queries = []
current_x = side_gap  # Start with a small gap at the beginning

for i, fed_member in enumerate(sorted_fed_members):
    group = sorted(queries_by_fed_member[fed_member], key=lambda x: x['number_triple_patterns'])
    for q in group:
        bar_positions.append(current_x)
        heights.append(q['number_triple_patterns'])
        bar_colors.append(fed_color_map[q['number_federation_member']])
        query_labels.append(q['display_name'])
        bar_queries.append(q)
        current_x += bar_width  # Bars within group touch, but are even skinnier
    if i < len(sorted_fed_members) - 1:
        current_x += bar_gap  # Only add gap between groups, not after last group

# Dynamically set width for label visibility
min_width = 7.5
per_query_width = 0.38
fig_width = max(min_width, len(bar_positions) * per_query_width)
fig, ax = plt.subplots(figsize=(fig_width, 10))  # Height fixed, width scales with number of queries

# Plot bars with hatching patterns only for queries with 3 federation members
hatch_pattern = '///'  # Use a clear pattern for 3 federation members only
bars = ax.bar(bar_positions, heights, color=bar_colors, width=bar_width, edgecolor='grey')

# Add symbols above bars for number_optional and number_union
for idx, (bar, label) in enumerate(zip(bars, query_labels)):
    # Bar index aligns with insertion order from grouped query list.
    q = bar_queries[idx] if idx < len(bar_queries) else None
    # Calculate a very small offset for the symbols so they are almost touching the tops of the bars
    offset = max(0.01 * bar.get_height(), 0.1)
    # Add 'O' for number_optional >= 1
    if q is not None and q.get('number_optional', 0) >= 1:
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + offset, 'O', ha='center', va='bottom', fontsize=16, color='black', fontweight='bold', family='monospace')
    # Add 'U' for number_union >= 1
    if q is not None and q.get('number_union', 0) >= 1:
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + offset, 'U', ha='center', va='bottom', fontsize=16, color='black', fontweight='bold', family='monospace')


# Apply hatching pattern only for federation member == 3
for idx, (bar, label) in enumerate(zip(bars, query_labels)):
    fed_member = None
    if idx < len(bar_queries):
        fed_member = bar_queries[idx]['number_federation_member']
    if fed_member == 3:
        bar.set_hatch(hatch_pattern)
    else:
        bar.set_hatch('')


# Set x-ticks to abbreviated query names, angled diagonally
ax.set_xticks(bar_positions)
ax.set_xticklabels(query_labels, fontsize=10, rotation=45, ha='right')
ax.set_xlim(min(bar_positions) - side_gap, max(bar_positions) + side_gap)

# Make title, axis labels, and y-axis numbers larger and bolded
ax.set_title('SPARQL Query Complexity (Grouped by Federation Member Numbers)', fontsize=18, fontweight='bold')
ax.set_xlabel('Query Name', fontsize=15, fontweight='bold')
ax.set_ylabel('Number of Triple Patterns', fontsize=15, fontweight='bold')
ax.tick_params(axis='y', labelsize=13, width=1.5)

# Update legend: show color and hatch for federation member, and ensure they match
handles = []
for fm in all_fed_members:
    if fm == 3:
        handles.append(mpl.patches.Patch(facecolor=fed_color_map[fm], edgecolor='grey',
                                         label=f"Federation Members: {fm}", hatch=hatch_pattern))
    else:
        handles.append(mpl.patches.Patch(facecolor=fed_color_map[fm], edgecolor='grey',
                                         label=f"Federation Members: {fm}", hatch=''))

# Create the color/hatch legend
legend1 = ax.legend(handles=handles, title="Number of Federation Members", loc='upper left', bbox_to_anchor=(0.01, 0.99), fontsize=13, title_fontsize=16, borderpad=1.0, labelspacing=1.0, handletextpad=0.8, alignment='left')

# Add symbol legend side-by-side with color legend, almost touching
symbol_handles = [
    plt.Line2D([0], [0], marker='$O$', color='w', label='Contains OPTIONAL', markerfacecolor='black', markersize=10, linestyle='None', markeredgecolor='black', markeredgewidth=1),
    plt.Line2D([0], [0], marker='$U$', color='w', label='Contains UNION', markerfacecolor='black', markersize=10, linestyle='None', markeredgecolor='black', markeredgewidth=1)
]
legend2 = ax.legend(handles=symbol_handles, loc='upper left', bbox_to_anchor=(0.21, 0.99), fontsize=13, title='Query Features', title_fontsize=16, borderpad=1.0, labelspacing=1.0, handletextpad=0.8, alignment='left')

# Bold legend titles
legend1.get_title().set_fontweight('bold')
legend2.get_title().set_fontweight('bold')

ax.add_artist(legend1)
ax.add_artist(legend2)

# Add horizontal grid lines for better readability of triple pattern numbers
ax.yaxis.grid(True, linestyle='--', linewidth=0.8, alpha=0.7, zorder=0)
ax.set_axisbelow(True)

ax.set_xlabel('Query Name')
ax.set_ylabel('Number of Triple Patterns')
ax.set_title('SPARQL Query Complexity (Grouped by Federation Members)', fontsize=18, fontweight='bold')
plt.tight_layout()
plt.savefig('Queries_Summary_Figure.png')  # Save the figure instead of showing it
# plt.show()  # Commented out to avoid warning in non-interactive environments
