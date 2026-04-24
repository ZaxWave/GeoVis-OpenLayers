"""
Task 10 — Python WFS Server (OGC WFS 1.1.0)
Serves xian.shp as a standards-compliant WFS service.

Usage:
    python wfs_server.py
    # Then open: http://localhost:5000/wfs?SERVICE=WFS&REQUEST=GetCapabilities

Supports:
    GetCapabilities, DescribeFeatureType, GetFeature
    BBOX filtering, output in EPSG:4326 or EPSG:3857
"""

from flask import Flask, request, Response
from flask_cors import CORS
import fiona
import json
from shapely.geometry import shape, box, mapping
from shapely.ops import transform
from shapely.strtree import STRtree
import pyproj
import os

app = Flask(__name__)
CORS(app)

SHP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'xian.shp')

# ── Preload features + spatial index for fast BBOX queries ──────────────────
_features_cache = None
_strtree = None

def _load():
    global _features_cache, _strtree
    if _features_cache is not None:
        return _features_cache, _strtree
    feats = []
    with fiona.open(SHP_PATH) as src:
        for feat in src:
            if feat['geometry'] is None:
                continue
            geom = shape(feat['geometry'])
            if not geom.is_valid:
                geom = geom.buffer(0)
            feats.append({
                'id': str(feat['id']),
                'geom': geom,
                'props': {k: (v if v is not None else '') for k, v in feat['properties'].items()}
            })
    _features_cache = feats
    _strtree = STRtree([f['geom'] for f in feats])
    print(f"[WFS] Loaded {len(feats)} features from {SHP_PATH}")
    return feats, _strtree


# ── Routing ──────────────────────────────────────────────────────────────────
@app.route('/wfs', methods=['GET', 'OPTIONS'])
def wfs():
    req = request.args.get('REQUEST', request.args.get('request', 'GetCapabilities')).upper()
    svc = request.args.get('SERVICE', request.args.get('service', 'WFS')).upper()
    if svc != 'WFS':
        return Response('Only WFS service is supported', status=400)
    dispatch = {
        'GETCAPABILITIES':    _get_capabilities,
        'DESCRIBEFEATURETYPE': _describe_feature_type,
        'GETFEATURE':         _get_feature,
    }
    handler = dispatch.get(req)
    if handler is None:
        return Response(f'Unknown REQUEST: {req}', status=400)
    return handler()


# ── GetCapabilities ──────────────────────────────────────────────────────────
def _get_capabilities():
    base_url = request.host_url.rstrip('/') + '/wfs'
    xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<WFS_Capabilities version="1.1.0"
  xmlns="http://www.opengis.net/wfs"
  xmlns:ows="http://www.opengis.net/ows"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ows:ServiceIdentification>
    <ows:Title>Python WFS Service</ows:Title>
    <ows:Abstract>OGC WFS 1.1.0 implemented in Python/Flask for xian.shp</ows:Abstract>
    <ows:ServiceType>WFS</ows:ServiceType>
    <ows:ServiceTypeVersion>1.1.0</ows:ServiceTypeVersion>
  </ows:ServiceIdentification>
  <ows:OperationsMetadata>
    <ows:Operation name="GetCapabilities">
      <ows:DCP><ows:HTTP><ows:Get xlink:href="{base_url}"/></ows:HTTP></ows:DCP>
    </ows:Operation>
    <ows:Operation name="DescribeFeatureType">
      <ows:DCP><ows:HTTP><ows:Get xlink:href="{base_url}"/></ows:HTTP></ows:DCP>
    </ows:Operation>
    <ows:Operation name="GetFeature">
      <ows:DCP><ows:HTTP><ows:Get xlink:href="{base_url}"/></ows:HTTP></ows:DCP>
      <ows:Parameter name="outputFormat">
        <ows:Value>application/json</ows:Value>
        <ows:Value>text/xml</ows:Value>
      </ows:Parameter>
    </ows:Operation>
  </ows:OperationsMetadata>
  <FeatureTypeList>
    <FeatureType>
      <Name>xian</Name>
      <Title>行政区划矢量数据 (xian.shp)</Title>
      <DefaultSRS>EPSG:4326</DefaultSRS>
      <OtherSRS>EPSG:3857</OtherSRS>
      <ows:WGS84BoundingBox>
        <ows:LowerCorner>73.487 18.375</ows:LowerCorner>
        <ows:UpperCorner>134.343 53.562</ows:UpperCorner>
      </ows:WGS84BoundingBox>
    </FeatureType>
  </FeatureTypeList>
</WFS_Capabilities>'''
    return Response(xml, mimetype='application/xml')


# ── DescribeFeatureType ──────────────────────────────────────────────────────
def _describe_feature_type():
    xml = '''<?xml version="1.0" encoding="UTF-8"?>
<schema xmlns="http://www.w3.org/2001/XMLSchema"
        xmlns:gml="http://www.opengis.net/gml"
        elementFormDefault="qualified" version="1.0">
  <import namespace="http://www.opengis.net/gml"
          schemaLocation="http://schemas.opengis.net/gml/3.1.1/base/gml.xsd"/>
  <complexType name="xianType">
    <complexContent>
      <extension base="gml:AbstractFeatureType">
        <sequence>
          <element name="geometry" type="gml:PolygonPropertyType"/>
          <element name="ddgl_code" type="string"/>
          <element name="ddgl_name" type="string"/>
        </sequence>
      </extension>
    </complexContent>
  </complexType>
  <element name="xian" type="xianType" substitutionGroup="gml:_Feature"/>
</schema>'''
    return Response(xml, mimetype='application/xml')


# ── GetFeature ───────────────────────────────────────────────────────────────
def _get_feature():
    max_features = int(request.args.get('count',
                       request.args.get('maxFeatures', 500)))
    bbox_str  = request.args.get('BBOX',    request.args.get('bbox', ''))
    srsname   = request.args.get('srsname', request.args.get('SRSNAME', 'EPSG:4326'))

    feats, tree = _load()

    # Parse BBOX (may end with ',EPSG:3857' or be bare numbers)
    bbox_geom = None
    bbox_is_3857 = '3857' in srsname
    if bbox_str:
        parts = [p.strip() for p in bbox_str.split(',')]
        nums = []
        for p in parts:
            try:
                nums.append(float(p))
            except ValueError:
                if '3857' in p:
                    bbox_is_3857 = True
        if len(nums) >= 4:
            if bbox_is_3857:
                t = pyproj.Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)
                x0, y0 = t.transform(nums[0], nums[1])
                x1, y1 = t.transform(nums[2], nums[3])
                bbox_geom = box(x0, y0, x1, y1)
            else:
                bbox_geom = box(nums[0], nums[1], nums[2], nums[3])

    # Candidate selection via STRtree then precise intersect
    if bbox_geom is not None:
        idxs = tree.query(bbox_geom)
        candidates = [feats[i] for i in idxs if feats[i]['geom'].intersects(bbox_geom)]
    else:
        candidates = feats

    candidates = candidates[:max_features]

    # Optional reprojection to requested SRS
    out_feats = []
    if '3857' in srsname:
        t_out = pyproj.Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
        for f in candidates:
            g = transform(t_out.transform, f['geom'])
            out_feats.append({'id': f['id'], 'geom': g, 'props': f['props']})
    else:
        out_feats = candidates

    geojson = {
        'type': 'FeatureCollection',
        'totalFeatures': len(out_feats),
        'numberMatched': len(out_feats),
        'numberReturned': len(out_feats),
        'features': [
            {
                'type': 'Feature',
                'id': f['id'],
                'geometry': mapping(f['geom']),
                'properties': f['props']
            }
            for f in out_feats
        ]
    }

    return Response(
        json.dumps(geojson, ensure_ascii=False),
        mimetype='application/json'
    )


if __name__ == '__main__':
    print('=' * 60)
    print('Python WFS Server  —  Task 10')
    print('Endpoint: http://localhost:5000/wfs')
    print('GetCapabilities:')
    print('  http://localhost:5000/wfs?SERVICE=WFS&REQUEST=GetCapabilities')
    print('=' * 60)
    _load()   # preload on startup
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)
