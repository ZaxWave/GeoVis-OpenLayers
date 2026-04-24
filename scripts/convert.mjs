/**
 * 将 xian.shp 转换为 GeoJSON 和 KML
 *
 * 方法A (推荐, 需要 GDAL):
 *   ogr2ogr -f GeoJSON -simplify 0.005 -t_srs EPSG:4326 -lco COORDINATE_PRECISION=5 public/data/xian.geojson data/xian.shp
 *   ogr2ogr -f KML     -simplify 0.01  -t_srs EPSG:4326 public/data/xian.kml data/xian.shp
 *
 * 方法B (纯 Node.js, 取前 N 个要素):
 *   node scripts/convert.mjs [data/xian.shp] [maxFeatures=200]
 *   依赖: npm install shapefile
 */
import shapefile from 'shapefile';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const MAX = parseInt(process.argv[3] || '200');
const SHP = resolve(process.argv[2] || 'data/xian.shp');
const OUT = 'public/data';
mkdirSync(OUT, { recursive: true });

console.log(`读取 ${SHP}，最多取前 ${MAX} 个要素…`);

// shapefile 在没有 .dbf 时只读几何，properties 为空对象
let source;
try {
    source = await shapefile.open(SHP, undefined, { encoding: 'UTF-8' });
} catch (e) {
    // 找不到 .dbf 属于正常情况，继续
    source = await shapefile.open(SHP);
}

const features = [];
let total = 0;
let result;
while (!(result = await source.read()).done) {
    if (!result.value?.geometry) continue;
    features.push({ ...result.value, id: total + 1, properties: result.value.properties || {} });
    if (++total >= MAX) break;
}
console.log(`共读取 ${total} 个要素`);

// ── 写 GeoJSON ──────────────────────────────────────────
const geojson = {
    type: 'FeatureCollection',
    name: 'xian',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    features
};
const gjPath = `${OUT}/xian.geojson`;
writeFileSync(gjPath, JSON.stringify(geojson));
console.log(`GeoJSON → ${gjPath}  (${(JSON.stringify(geojson).length / 1024).toFixed(0)} KB)`);

// ── 写 KML ─────────────────────────────────────────────
const kmlPath = `${OUT}/xian.kml`;
writeFileSync(kmlPath, toKML(features, 'xian'));
console.log(`KML    → ${kmlPath}`);

// ── 工具函数 ────────────────────────────────────────────
function toKML(features, name) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${name}</name>
  <Style id="poly"><LineStyle><color>ffff6600</color><width>1</width></LineStyle>
    <PolyStyle><color>330066ff</color></PolyStyle></Style>
${features.map(f => placemark(f)).join('\n')}
</Document>
</kml>`;
}

function placemark(f) {
    const name = f.properties?.name || f.properties?.NAME || f.properties?.Name || String(f.id);
    return `  <Placemark>
    <name>${esc(name)}</name>
    <styleUrl>#poly</styleUrl>
    ${geomKML(f.geometry)}
  </Placemark>`;
}

function geomKML(g) {
    if (!g) return '';
    switch (g.type) {
        case 'Polygon':
            return polygon(g.coordinates);
        case 'MultiPolygon':
            return `<MultiGeometry>${g.coordinates.map(rings => polygon(rings)).join('')}</MultiGeometry>`;
        case 'Point':
            return `<Point><coordinates>${g.coordinates.join(',')},0</coordinates></Point>`;
        case 'LineString':
            return `<LineString><coordinates>${g.coordinates.map(c => c.join(',') + ',0').join(' ')}</coordinates></LineString>`;
        default: return '';
    }
}

function polygon(rings) {
    const outer = rings[0].map(c => c.join(',') + ',0').join(' ');
    const inner = rings.slice(1).map(r =>
        `<innerBoundaryIs><LinearRing><coordinates>${r.map(c => c.join(',') + ',0').join(' ')}</coordinates></LinearRing></innerBoundaryIs>`
    ).join('');
    return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${outer}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon>`;
}

function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
