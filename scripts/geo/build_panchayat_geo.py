"""
Builds real panchayat locations and outlines for the map.

Input
  * public/data/panchayats.json — our panchayat list (LGD), with each panchayat's villages.
  * Census 2011 village boundaries for Bihar from DataMeet
    (https://github.com/datameet/indian_village_boundaries, file br/br.geojson, ODbL).

How it works
  1. Match our blocks to Census sub-districts (CD blocks) by name, allowing spelling
     differences (Kursakanta = Kursakatta, Rupouli = Rupauli ...).
  2. Inside each block, match each panchayat's villages to Census villages by name.
     When a name occurs twice in the block, keep the copy closest to the panchayat's
     other villages. Villages more than 12 km from the rest are dropped as mismatches.
  3. A panchayat with no village list falls back to the Census village that carries the
     panchayat's own name (the panchayat headquarters), then to the block centre.
  4. Outline = the matched villages merged together; location = a point inside it.

Output
  * public/data/panchayats.json and backend/.../SeedData/panchayats.json get the new
    centroidLat/centroidLng plus locationSource (villages | hq-village | block) and
    matchedVillages.
  * public/data/panchayat-areas.geojson — one outline per panchayat (id = panchayat id).
  * public/data/seemanchal_blocks.geojson — real block outlines (replaces placeholder boxes).

Run:  python3 scripts/geo/build_panchayat_geo.py path/to/br.geojson
West Bengal (Uttar Dinajpur) is not in the DataMeet set, so those stay at block level
until field check-ins or an official boundary file fix them.
"""
import collections, difflib, json, math, re, sys
from pathlib import Path
from shapely.geometry import shape, mapping, MultiPolygon, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public' / 'data'
SEED = ROOT / 'backend' / 'SeemanchalOutreach.Api' / 'SeedData' / 'panchayats.json'
DISTRICTS = {'Araria', 'Supaul', 'Kishanganj', 'Purnia', 'Katihar'}
MAX_SPREAD_KM = 12


def norm(s):
    s = (s or '').lower()
    s = re.sub(r'\(.*?\)', '', s)
    s = re.sub(r'\b(north|south|east|west|uttar|dakshin|purab|purbi|paschim|purvi|madhya|panchayat|gram|no|part)\b', '', s)
    s = re.sub(r'[^a-z]', '', s)
    for a, b in [('aa', 'a'), ('ee', 'i'), ('oo', 'u'), ('w', 'v'), ('sh', 's'), ('ph', 'f'), ('z', 'j'), ('ou', 'au')]:
        s = s.replace(a, b)
    return s


def km(a, b):
    (lat1, lon1), (lat2, lon2) = a, b
    p = math.pi / 180
    h = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def pt(geom):
    c = geom.centroid if geom.contains(geom.centroid) else geom.representative_point()
    return (round(c.y, 6), round(c.x, 6))


def main(census_path):
    feats = json.load(open(census_path))['features']
    by_block = collections.defaultdict(list)   # (district, norm block) -> [(normname, geom, point)]
    block_names = {}
    for f in feats:
        p = f['properties']
        if p.get('DISTRICT') not in DISTRICTS or not f.get('geometry'):
            continue
        g = shape(f['geometry'])
        if not g.is_valid:
            g = g.buffer(0)
        if g.is_empty:
            continue
        k = (p['DISTRICT'], norm(p['SUB_DIST']))
        block_names[k] = p['SUB_DIST']
        by_block[k].append((norm(p['NAME']), g, pt(g)))

    def block_key(district, block):
        k = (district, norm(block))
        if k in by_block:
            return k
        cands = [b for (d, b) in by_block if d == district]
        m = difflib.get_close_matches(norm(block), cands, 1, 0.7)
        return (district, m[0]) if m else None

    panchayats = json.load(open(PUBLIC / 'panchayats.json'))
    block_geom = {k: unary_union([g for _, g, _ in v]) for k, v in by_block.items()}
    areas, stats = [], collections.Counter()

    for p in panchayats:
        p.pop('locationSource', None); p.pop('matchedVillages', None)
        if p['district'] not in DISTRICTS:
            p['locationSource'] = 'block'
            stats['block (no census data)'] += 1
            continue
        k = block_key(p['district'], p['block'])
        vill = by_block.get(k, [])
        names = collections.defaultdict(list)
        for v in vill:
            names[v[0]].append(v)

        def lookup(n, cutoff=0.86):
            if not n:
                return []
            if n in names:
                return names[n]
            m = difflib.get_close_matches(n, list(names), 1, cutoff)
            return names[m[0]] if m else []

        unique, ambiguous = [], []
        for v in p.get('villages') or []:
            hits = lookup(norm(v))
            (unique if len(hits) == 1 else ambiguous if hits else []).append(hits if len(hits) > 1 else hits[0] if hits else None)
        unique = [u for u in unique if u]
        anchor = None
        if unique:
            lat = sorted(u[2][0] for u in unique)[len(unique) // 2]
            lng = sorted(u[2][1] for u in unique)[len(unique) // 2]
            anchor = (lat, lng)
        for hits in ambiguous:
            if anchor:
                unique.append(min(hits, key=lambda h: km(h[2], anchor)))
        if unique:
            if not anchor:
                anchor = unique[0][2]
            unique = [u for u in unique if km(u[2], anchor) <= MAX_SPREAD_KM]
        source = 'villages'
        if not unique:
            hits = lookup(norm(p['name']), 0.9)
            if len(hits) == 1:
                unique, source = hits, 'hq-village'
        if unique:
            geom = unary_union([u[1] for u in unique]).simplify(0.0003, preserve_topology=True)
            lat, lng = pt(geom)
            p['centroidLat'], p['centroidLng'] = lat, lng
            p['locationSource'] = source
            p['matchedVillages'] = len(unique)
            if geom.geom_type == 'Polygon':
                geom = MultiPolygon([geom])
            rounded = json.loads(json.dumps(mapping(geom)), parse_float=lambda x: round(float(x), 5))
            areas.append({'type': 'Feature', 'id': p['id'], 'properties': {'id': p['id'], 'name': p['name'], 'block': p['block'], 'district': p['district'], 'source': source}, 'geometry': rounded})
            stats[source] += 1
        else:
            if k in block_geom:
                p['centroidLat'], p['centroidLng'] = pt(block_geom[k])
            p['locationSource'] = 'block'
            stats['block'] += 1

    # Real block outlines (Bihar) — placeholder boxes are replaced.
    ours = {(p['district'], p['block']) for p in panchayats}
    blocks = []
    for (d, b) in sorted(ours):
        k = block_key(d, b)
        if not k:
            continue
        g = block_geom[k].simplify(0.001, preserve_topology=True)
        if g.geom_type == 'Polygon':
            g = MultiPolygon([g])
        n = sum(1 for p in panchayats if p['district'] == d and p['block'] == b)
        rounded = json.loads(json.dumps(mapping(g)), parse_float=lambda x: round(float(x), 5))
        blocks.append({'type': 'Feature', 'properties': {'district': d, 'block': b, 'code': f'BR-{d[:3].upper()}-{b[:3].upper()}', 'total_villages': len(by_block[k]), 'total_panchayats': n}, 'geometry': rounded})

    txt = json.dumps(panchayats, ensure_ascii=False, indent=2)
    (PUBLIC / 'panchayats.json').write_text(txt + '\n')
    SEED.write_text(txt + '\n')
    (PUBLIC / 'panchayat-areas.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': areas}, separators=(',', ':')))
    (PUBLIC / 'seemanchal_blocks.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': blocks}, separators=(',', ':')))
    print(dict(stats), 'blocks', len(blocks))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'br.geojson')
