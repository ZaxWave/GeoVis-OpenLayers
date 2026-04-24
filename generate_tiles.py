"""
Task 11 — 矢量瓦片 + 栅格瓦片 生成脚本

从 data/xian.shp 生成：
  public/tiles/vector/{z}/{x}/{y}.pbf   ← 矢量瓦片 (Mapbox Vector Tile)
  public/tiles/raster/{z}/{x}/{y}.png   ← 栅格瓦片 (PNG)

Usage:
    python generate_tiles.py [zoom_min] [zoom_max]
    python generate_tiles.py            # default: zoom 3-8
    python generate_tiles.py 4 7        # zoom 4-7 only

Dependencies:
    pip install fiona shapely mercantile mapbox-vector-tile pillow pyproj
"""

import os
import sys
import fiona
import mercantile
import mapbox_vector_tile
from shapely.geometry import shape, mapping, box
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree
import pyproj
from PIL import Image, ImageDraw
import time

# ── Config ───────────────────────────────────────────────────────────────────
SHP_PATH   = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'xian.shp')
OUT_BASE   = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public', 'tiles')
ZOOM_MIN   = int(sys.argv[1]) if len(sys.argv) > 1 else 3
ZOOM_MAX   = int(sys.argv[2]) if len(sys.argv) > 2 else 8
MVT_EXTENT = 4096
TILE_SIZE  = 256

# Raster tile colour scheme (dark theme)
RASTER_BG      = (15,  30,  50,  255)   # dark navy background
RASTER_FILL    = (70, 130, 180, 200)    # steel-blue fill (semi-transparent)
RASTER_STROKE  = (140, 200, 255, 255)   # light-blue border


# ── 1. Load + index features ─────────────────────────────────────────────────
def load_features():
    feats = []
    with fiona.open(SHP_PATH) as src:
        for feat in src:
            if feat['geometry'] is None:
                continue
            geom = shape(feat['geometry'])
            if not geom.is_valid:
                geom = geom.buffer(0)
            feats.append({
                'geom': geom,
                'props': {k: (str(v) if v is not None else '') for k, v in feat['properties'].items()}
            })
    return feats


# ── 2. Raster tile ───────────────────────────────────────────────────────────
def _geo_to_px(lon, lat, bounds):
    """Geographic coordinate → pixel (x, y) within TILE_SIZE×TILE_SIZE image."""
    x = (lon - bounds.west)  / (bounds.east  - bounds.west)  * TILE_SIZE
    y = (1 - (lat - bounds.south) / (bounds.north - bounds.south)) * TILE_SIZE
    return x, y


def make_raster_tile(features, tree, tile):
    bounds   = mercantile.bounds(tile)
    tile_box = box(bounds.west, bounds.south, bounds.east, bounds.north)

    img  = Image.new('RGBA', (TILE_SIZE, TILE_SIZE), RASTER_BG)
    draw = ImageDraw.Draw(img)
    drew = False

    idxs = tree.query(tile_box)
    for i in idxs:
        feat = features[i]
        if not feat['geom'].intersects(tile_box):
            continue
        try:
            clipped = feat['geom'].intersection(tile_box)
        except Exception:
            continue
        if clipped.is_empty:
            continue

        polys = (clipped.geoms if hasattr(clipped, 'geoms') else [clipped])
        for poly in polys:
            if poly.geom_type not in ('Polygon', 'MultiPolygon'):
                continue
            sub = poly.geoms if poly.geom_type == 'MultiPolygon' else [poly]
            for p in sub:
                coords = [_geo_to_px(x, y, bounds) for x, y in p.exterior.coords]
                if len(coords) >= 3:
                    draw.polygon(coords, fill=RASTER_FILL, outline=RASTER_STROKE)
                    drew = True

    return img, drew


# ── 3. Vector (MVT) tile ─────────────────────────────────────────────────────
def make_vector_tile(features, tree, tile):
    bounds   = mercantile.bounds(tile)
    tile_box = box(bounds.west, bounds.south, bounds.east, bounds.north)

    tile_feats = []
    idxs = tree.query(tile_box)
    for i in idxs:
        feat = features[i]
        if not feat['geom'].intersects(tile_box):
            continue
        try:
            clipped = feat['geom'].intersection(tile_box)
        except Exception:
            continue
        if clipped.is_empty:
            continue
        tile_feats.append({
            'geometry': mapping(clipped),
            'properties': feat['props']
        })

    if not tile_feats:
        return None

    try:
        encoded = mapbox_vector_tile.encode(
            [{'name': 'xian', 'features': tile_feats}],
            default_options={
                'quantize_bounds': (bounds.west, bounds.south, bounds.east, bounds.north),
                'extents': MVT_EXTENT
            }
        )
        return encoded
    except Exception as e:
        print(f"    [warn] MVT encode failed for {tile}: {e}")
        return None


# ── 4. Write helpers ─────────────────────────────────────────────────────────
def _tile_dir(base, tile):
    return os.path.join(base, str(tile.z), str(tile.x))

def save_raster(img, base, tile):
    d = _tile_dir(base, tile)
    os.makedirs(d, exist_ok=True)
    img.save(os.path.join(d, f'{tile.y}.png'))

def save_vector(data, base, tile):
    d = _tile_dir(base, tile)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, f'{tile.y}.pbf'), 'wb') as f:
        f.write(data)


# ── 5. Main ──────────────────────────────────────────────────────────────────
def main():
    t0 = time.time()
    print(f"Loading {SHP_PATH} …")
    features = load_features()
    print(f"  {len(features)} features loaded  ({time.time()-t0:.1f}s)")

    print("Building spatial index …")
    tree = STRtree([f['geom'] for f in features])

    # Data bounds
    union_bounds = unary_union([f['geom'] for f in features]).bounds
    data_bbox = (union_bounds[0], union_bounds[1], union_bounds[2], union_bounds[3])
    print(f"  Data bbox (WGS84): {[round(x,3) for x in data_bbox]}")

    raster_dir = os.path.join(OUT_BASE, 'raster')
    vector_dir = os.path.join(OUT_BASE, 'vector')
    os.makedirs(raster_dir, exist_ok=True)
    os.makedirs(vector_dir, exist_ok=True)

    total_r = total_v = 0

    for zoom in range(ZOOM_MIN, ZOOM_MAX + 1):
        tiles = list(mercantile.tiles(*data_bbox, zooms=zoom))
        r_n = v_n = 0

        for tile in tiles:
            img, drew = make_raster_tile(features, tree, tile)
            save_raster(img, raster_dir, tile)   # always save (bg tile even if empty)
            if drew:
                r_n += 1

            mvt = make_vector_tile(features, tree, tile)
            if mvt:
                save_vector(mvt, vector_dir, tile)
                v_n += 1

        print(f"  zoom {zoom}: {len(tiles)} tiles | raster {r_n} filled | vector {v_n} non-empty")
        total_r += r_n
        total_v += v_n

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s")
    print(f"  Raster tiles: {total_r}  →  {raster_dir}")
    print(f"  Vector tiles: {total_v}  →  {vector_dir}")
    print(f"\nStart the dev server (npm run dev) and open the page to view tiles.")


if __name__ == '__main__':
    main()
