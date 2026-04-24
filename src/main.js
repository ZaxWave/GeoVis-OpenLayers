import 'ol/ol.css';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import XYZ from 'ol/source/XYZ';
import OSM from 'ol/source/OSM';
import BingMaps from 'ol/source/BingMaps';
import TileImage from 'ol/source/TileImage';
import VectorSource from 'ol/source/Vector';
import TileGrid from 'ol/tilegrid/TileGrid';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import Overlay from 'ol/Overlay';
import GeoJSONFormat from 'ol/format/GeoJSON';
import KML from 'ol/format/KML';
import TileWMS from 'ol/source/TileWMS';
import WMTS, { optionsFromCapabilities } from 'ol/source/WMTS';
import WMTSCapabilities from 'ol/format/WMTSCapabilities';
import { bbox as bboxStrategy } from 'ol/loadingstrategy';
import { initTasks } from './tasks789.js';
import { initTasks1011 } from './tasks1011.js';

// ── 请在此填写您的 API 密钥 ──────────────────────────────
const KEY = {
    tianditu: 'e84faf79617295254251840d50c9a98c',   // https://console.tianditu.gov.cn/
    gaode:    'efae81f8eaeb3f795fc602eb766e5d68', // https://console.amap.com/
    baidu:    'mLdEXGvRlUT4WxbjwFRvgnmMO569Dprv',         // https://lbsyun.baidu.com/
    bing:     '您的Bing Maps Key'   // https://www.bingmapsportal.com/
};

// ═══════════════════════════════════════════════════════
//  天地图图层
//  DataServer 格式：T=图层名&x={x}&y={y}&l={z}&tk=密钥
//  影像底图(img_w) + 影像注记(cia_w)
//  矢量底图(vec_w) + 矢量注记(cva_w)
// ═══════════════════════════════════════════════════════
const tdt = (layer) =>
    `https://t{0-7}.tianditu.gov.cn/DataServer?T=${layer}&x={x}&y={y}&l={z}&tk=${KEY.tianditu}`;

const tdtImgLayer = new TileLayer({ source: new XYZ({ url: tdt('img_w'), crossOrigin: 'anonymous' }) });
const tdtImgAnno  = new TileLayer({ source: new XYZ({ url: tdt('cia_w'), crossOrigin: 'anonymous' }) });
const tdtVecLayer = new TileLayer({ source: new XYZ({ url: tdt('vec_w'), crossOrigin: 'anonymous' }), visible: false });
const tdtVecAnno  = new TileLayer({ source: new XYZ({ url: tdt('cva_w'), crossOrigin: 'anonymous' }), visible: false });

// ═══════════════════════════════════════════════════════
//  高德图层  (GCJ-02坐标，与 EPSG:3857 有约400m偏移)
//  style=6 影像  style=8 矢量道路
// ═══════════════════════════════════════════════════════
const gaodeImgLayer = new TileLayer({
    source: new XYZ({ url: 'https://webst0{1-4}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}' }),
    visible: false
});
const gaodeVecLayer = new TileLayer({
    source: new XYZ({ url: 'https://webrd0{1-4}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}' }),
    visible: false
});

// ═══════════════════════════════════════════════════════
//  百度图层  (BD-09坐标，y轴向上 —— 需要自定义 TileGrid)
//  resolutions[z] = 2^(18-z) 为百度坐标系单位/像素
//  tileCoord[2] 在 OL 中 y 向下，转换为百度 y: -y-1
// ═══════════════════════════════════════════════════════
const baiduResolutions = Array.from({ length: 19 }, (_, i) => Math.pow(2, 18 - i));
const baiduTileGrid = new TileGrid({
    resolutions: baiduResolutions,
    origin: [0, 0],
    extent: [-20037726.37, -12474104.17, 20037726.37, 12474104.17]
});

function makeBaiduLayer(urlFn, visible = false) {
    return new TileLayer({
        source: new TileImage({
            projection: 'EPSG:3857',
            tileGrid: baiduTileGrid,
            tileUrlFunction([z, x, y]) {
                return urlFn(z, x, -y - 1);
            }
        }),
        visible
    });
}

const baiduImgLayer = makeBaiduLayer((z, x, y) => {
    const s = (x + y) & 3;
    return `http://shangetu${s}.map.bdimg.com/it/u=x=${x};y=${y};z=${z};v=009;type=sate&fm=46`;
});

const baiduVecLayer = makeBaiduLayer((z, x, y) => {
    const s = (x + y) & 3;
    return `http://online${s}.map.bdimg.com/tile/?qt=tile&x=${x}&y=${y}&z=${z}&styles=pl&b=01&udt=20150815&scaler=1`;
});

// ═══════════════════════════════════════════════════════
//  OpenStreetMap
// ═══════════════════════════════════════════════════════
const osmLayer = new TileLayer({ source: new OSM(), visible: false });

// ═══════════════════════════════════════════════════════
//  Bing 地图  (需有效 API Key)
//  imagerySet: AerialWithLabelsOnDemand | RoadOnDemand | CanvasDark …
// ═══════════════════════════════════════════════════════
const hasBingKey = KEY.bing && !KEY.bing.includes('您的');
const bingImgLayer = new TileLayer({
    source: hasBingKey ? new BingMaps({ key: KEY.bing, imagerySet: 'AerialWithLabelsOnDemand' }) : new OSM(),
    visible: false
});
const bingVecLayer = new TileLayer({
    source: hasBingKey ? new BingMaps({ key: KEY.bing, imagerySet: 'RoadOnDemand' }) : new OSM(),
    visible: false
});

// ═══════════════════════════════════════════════════════
//  Google 地图  (非官方 XYZ 瓦片，lyrs=s 影像，lyrs=m 矢量)
//  注意：在部分网络环境下可能无法访问
// ═══════════════════════════════════════════════════════
const googleImgLayer = new TileLayer({
    source: new XYZ({ url: 'https://mt{0-3}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', maxZoom: 20 }),
    visible: false
});
const googleVecLayer = new TileLayer({
    source: new XYZ({ url: 'https://mt{0-3}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', maxZoom: 20 }),
    visible: false
});

// ═══════════════════════════════════════════════════════
//  POI 标注图层
// ═══════════════════════════════════════════════════════
const poiSource = new VectorSource();
const poiLayer = new VectorLayer({
    source: poiSource,
    style: new Style({
        image: new CircleStyle({
            radius: 7,
            fill: new Fill({ color: '#e84040' }),
            stroke: new Stroke({ color: '#fff', width: 2 })
        })
    }),
    zIndex: 100
});

// ═══════════════════════════════════════════════════════
//  地图初始化
// ═══════════════════════════════════════════════════════
const allBaseLayers = [
    tdtImgLayer, tdtImgAnno,
    tdtVecLayer, tdtVecAnno,
    gaodeImgLayer, gaodeVecLayer,
    baiduImgLayer, baiduVecLayer,
    osmLayer,
    bingImgLayer, bingVecLayer,
    googleImgLayer, googleVecLayer
];

const map = new Map({
    target: 'map',
    layers: [...allBaseLayers, poiLayer],
    view: new View({
        center: fromLonLat([116.397, 39.908]),
        zoom: 10
    })
});
window._olMap = map;

// ═══════════════════════════════════════════════════════
//  图层切换
// ═══════════════════════════════════════════════════════
const layerGroups = {
    tdt_img:    [tdtImgLayer, tdtImgAnno],
    tdt_vec:    [tdtVecLayer, tdtVecAnno],
    gaode_img:  [gaodeImgLayer],
    gaode_vec:  [gaodeVecLayer],
    baidu_img:  [baiduImgLayer],
    baidu_vec:  [baiduVecLayer],
    osm:        [osmLayer],
    bing_img:   [bingImgLayer],
    bing_vec:   [bingVecLayer],
    google_img: [googleImgLayer],
    google_vec: [googleVecLayer]
};

const layerLabels = {
    tdt_img: '天地图影像', tdt_vec: '天地图矢量',
    gaode_img: '高德影像', gaode_vec: '高德矢量',
    baidu_img: '百度影像', baidu_vec: '百度矢量',
    osm: 'OpenStreetMap',
    bing_img: 'Bing影像',  bing_vec: 'Bing道路',
    google_img: 'Google影像', google_vec: 'Google矢量'
};

window.switchLayer = (btn, type) => {
    allBaseLayers.forEach(l => l.setVisible(false));
    (layerGroups[type] || []).forEach(l => l.setVisible(true));
    document.querySelectorAll('.map-btn[data-layer]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const label = layerLabels[type] || type;
    const el1 = document.getElementById('layer-label-text');
    const el2 = document.getElementById('layer-label-status');
    if (el1) el1.textContent = label;
    if (el2) el2.textContent = label;
};

// ═══════════════════════════════════════════════════════
//  Popup 弹窗
// ═══════════════════════════════════════════════════════
const popupEl = document.getElementById('popup');
const popupContent = document.getElementById('popup-content');
const popupCloser = document.getElementById('popup-closer');

const popup = new Overlay({
    element: popupEl,
    autoPan: { animation: { duration: 250 } }
});
map.addOverlay(popup);

popupCloser.onclick = () => { popup.setPosition(undefined); return false; };

map.on('singleclick', evt => {
    const feature = map.forEachFeatureAtPixel(evt.pixel, f => f);
    if (feature) {
        // 优先取 ddgl_name（本地矢量），其次 name（POI）
        const title = feature.get('ddgl_name') || feature.get('name');
        const sub = feature.get('ddgl_code') || feature.get('address') || '';
        if (title) {
            popupContent.innerHTML =
                `<strong>${title}</strong>` +
                (sub ? `<br><small>${sub}</small>` : '');
            popup.setPosition(evt.coordinate);
            return;
        }
    }
    popup.setPosition(undefined);
});

// ═══════════════════════════════════════════════════════
//  POI 搜索  (通过 vite.config.js 代理解决 CORS 问题)
// ═══════════════════════════════════════════════════════
const poiResultsEl = document.getElementById('poi-results');
let currentFeatures = [];

window.searchPOI = async () => {
    const keyword = document.getElementById('poi-keyword').value.trim();
    const provider = document.getElementById('poi-provider').value;
    if (!keyword) { alert('请输入搜索关键词'); return; }

    poiSource.clear();
    popup.setPosition(undefined);
    poiResultsEl.innerHTML = '<p>搜索中…</p>';

    try {
        const handlers = { tianditu: searchTianditu, gaode: searchGaode, baidu: searchBaidu };
        const results = await handlers[provider](keyword);
        renderResults(results);
    } catch (e) {
        poiResultsEl.innerHTML = `<p style="color:#f88">搜索失败：${e.message}</p>`;
    }
};

// ── 天地图 POI ─────────────────────────────────────────
async function searchTianditu(keyword) {
    const view = map.getView();
    const [minX, minY, maxX, maxY] = view.calculateExtent(map.getSize());
    const [minLon, minLat] = toLonLat([minX, minY]);
    const [maxLon, maxLat] = toLonLat([maxX, maxY]);

    const postStr = JSON.stringify({
        keyWord: keyword,
        level: String(Math.round(view.getZoom())),
        mapBound: `${minLon.toFixed(6)},${minLat.toFixed(6)},${maxLon.toFixed(6)},${maxLat.toFixed(6)}`,
        queryType: '1',
        start: '0',
        count: '20'
    });

    const url = `/api/poi/tianditu?postStr=${encodeURIComponent(postStr)}&type=query&tk=${KEY.tianditu}`;
    const data = await fetchJSON(url);
    if (data.msg) throw new Error(data.msg);
    return (data.pois || []).map(p => ({
        name: p.name,
        address: p.address,
        lon: parseFloat(p.lonlat.split(',')[0]),
        lat: parseFloat(p.lonlat.split(',')[1])
    }));
}

// ── 高德 POI ───────────────────────────────────────────
async function searchGaode(keyword) {
    const url = `/api/poi/gaode?keywords=${encodeURIComponent(keyword)}&key=${KEY.gaode}&output=json&offset=20&page=1&extensions=base`;
    const data = await fetchJSON(url);
    if (data.status !== '1') throw new Error(data.info || '高德API错误');
    return (data.pois || []).map(p => ({
        name: p.name,
        address: Array.isArray(p.address) ? '' : p.address,
        lon: parseFloat(p.location.split(',')[0]),
        lat: parseFloat(p.location.split(',')[1])
    }));
}

// ── 百度 POI ───────────────────────────────────────────
async function searchBaidu(keyword) {
    // ret_coordtype=gcj02ll 让百度返回 GCJ-02 坐标，减少偏移
    const url = `/api/poi/baidu?query=${encodeURIComponent(keyword)}&region=全国&output=json&ak=${KEY.baidu}&ret_coordtype=gcj02ll&page_size=20`;
    const data = await fetchJSON(url);
    if (data.status !== 0) throw new Error(data.message || '百度API错误');
    return (data.results || []).map(p => ({
        name: p.name,
        address: p.address,
        lon: p.location.lng,
        lat: p.location.lat
    }));
}

async function fetchJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
}

// ── 结果渲染 ───────────────────────────────────────────
function renderResults(results) {
    currentFeatures = results.map(r =>
        new Feature({
            geometry: new Point(fromLonLat([r.lon, r.lat])),
            name: r.name,
            address: r.address
        })
    );
    poiSource.addFeatures(currentFeatures);

    if (currentFeatures.length) {
        map.getView().fit(poiSource.getExtent(), {
            padding: [60, 60, 60, 60],
            maxZoom: 14,
            duration: 500
        });
    }

    if (!results.length) {
        poiResultsEl.innerHTML = '<p>未找到相关结果</p>';
        return;
    }

    poiResultsEl.innerHTML = `
        <p>共 ${results.length} 条结果</p>
        <ul>
            ${results.map((r, i) => `
                <li onclick="focusPOI(${i})">
                    <strong>${r.name}</strong>
                    <small>${r.address || '暂无地址'}</small>
                </li>`).join('')}
        </ul>`;
}

window.focusPOI = (i) => {
    const f = currentFeatures[i];
    if (!f) return;
    const coords = f.getGeometry().getCoordinates();
    map.getView().animate({ center: coords, zoom: 15, duration: 400 });
    popupContent.innerHTML =
        `<strong>${f.get('name')}</strong><br><small>${f.get('address') || ''}</small>`;
    popup.setPosition(coords);
};

// 默认激活天地图影像按钮
document.querySelector('[data-layer="tdt_img"]')?.classList.add('active');
const _el1 = document.getElementById('layer-label-text');
const _el2 = document.getElementById('layer-label-status');
if (_el1) _el1.textContent = '天地图影像';
if (_el2) _el2.textContent = '天地图影像';

// Task 7 / 8 / 9
initTasks(map);

// Task 10 / 11
initTasks1011(map);

// ═══════════════════════════════════════════════════════
//  Task 5 — 本地矢量数据 (GeoJSON / KML)
//  数据来源: node scripts/convert.mjs  或  ogr2ogr (见 convert.mjs 注释)
// ═══════════════════════════════════════════════════════

// 通用要素样式（按几何类型区分）
function localFeatureStyle(feature) {
    const t = feature.getGeometry().getType();
    if (t === 'Point' || t === 'MultiPoint') {
        return new Style({
            image: new CircleStyle({ radius: 5, fill: new Fill({ color: '#e84040' }), stroke: new Stroke({ color: '#fff', width: 1.5 }) })
        });
    }
    if (t.includes('Line')) {
        return new Style({ stroke: new Stroke({ color: '#0077ff', width: 2 }) });
    }
    return new Style({
        stroke: new Stroke({ color: '#ff6600', width: 1 }),
        fill: new Fill({ color: 'rgba(0,119,255,0.08)' })
    });
}

// GeoJSON 图层
const geojsonLayer = new VectorLayer({
    source: new VectorSource({
        url: '/data/xian.geojson',
        format: new GeoJSONFormat({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })
    }),
    style: localFeatureStyle,
    visible: false,
    zIndex: 50
});

// KML 图层
const kmlLayer = new VectorLayer({
    source: new VectorSource({
        url: '/data/xian.kml',
        format: new KML({ extractStyles: false, defaultDataProjection: 'EPSG:4326' })
    }),
    style: localFeatureStyle,
    visible: false,
    zIndex: 50
});

map.addLayer(geojsonLayer);
map.addLayer(kmlLayer);

let activeLocalLayer = null;

window.loadLocalLayer = (btn, type) => {
    // 清除旧的本地图层激活状态
    document.querySelectorAll('.local-btn').forEach(b => b.classList.remove('active'));

    if (activeLocalLayer === type) {
        // 再次点击同一个 → 关闭
        geojsonLayer.setVisible(false);
        kmlLayer.setVisible(false);
        activeLocalLayer = null;
        document.getElementById('local-status').textContent = '';
        return;
    }

    geojsonLayer.setVisible(type === 'geojson');
    kmlLayer.setVisible(type === 'kml');
    activeLocalLayer = type;
    btn.classList.add('active');

    const layer = type === 'geojson' ? geojsonLayer : kmlLayer;
    document.getElementById('local-status').textContent = '加载中…';

    layer.getSource().once('featuresloadend', () => {
        const count = layer.getSource().getFeatures().length;
        document.getElementById('local-status').textContent = `已加载 ${count} 个要素`;
        if (count > 0) {
            map.getView().fit(layer.getSource().getExtent(), { padding: [40, 40, 40, 40], duration: 600 });
        }
    });
    layer.getSource().once('featuresloaderror', () => {
        document.getElementById('local-status').textContent = '加载失败，请先运行 convert.mjs';
    });
};

// ═══════════════════════════════════════════════════════
//  Task 6 — GeoServer WMS / WMTS / WFS
//  默认地址: http://localhost:8080/geoserver
//  修改下方 GS 对象中的工作区和图层名以匹配您的 GeoServer 配置
// ═══════════════════════════════════════════════════════
const GS = {
    base: '/geoserver',
    workspace: 'lab5',          // ← 修改为您的工作区
    layers: {
        img50m:  'lab5:时空大数据平台数据2',  // 50M 影像（栅格）
        img50g:  'lab5:xian',               // 矢量（xian.shp）
        shape1:  'lab5:xian',
        shape2:  null
    }
};

// ── GeoServer WMS (TileWMS 分块请求，对大影像更高效) ──
function makeWmsLayer(layerName, isRaster = false) {
    return new TileLayer({
        source: new TileWMS({
            url: `${GS.base}/${GS.workspace}/wms`,
            params: {
                LAYERS: layerName,
                TILED: true,
                FORMAT: isRaster ? 'image/jpeg' : 'image/png',
                TRANSPARENT: !isRaster
            },
            serverType: 'geoserver',
            crossOrigin: 'anonymous',
            transition: 0
        }),
        visible: false,
        zIndex: 80
    });
}

const gsWmsImg50m  = makeWmsLayer(GS.layers.img50m,  true);
const gsWmsImg50g  = makeWmsLayer(GS.layers.img50g,  false);
const gsWmsShape1  = makeWmsLayer(GS.layers.shape1,  false);
const gsWmsShape2  = GS.layers.shape2 ? makeWmsLayer(GS.layers.shape2, false) : new TileLayer({ visible: false });

// ── GeoServer WMTS (从 GetCapabilities 自动解析) ──────
const gsWmtsLayer = new TileLayer({ visible: false, zIndex: 80 });

// ── GeoServer WFS (矢量，BBOX 策略按视图范围请求) ─────
const gsWfsSource = new VectorSource({
    format: new GeoJSONFormat(),
    url: (extent) => {
        const layerName = document.getElementById('gs-wfs-layer')?.value || GS.layers.shape1;
        return `${GS.base}/wfs?service=WFS&version=1.1.0&request=GetFeature` +
               `&typeName=${layerName}&outputFormat=application/json` +
               `&srsname=EPSG:3857&bbox=${extent.join(',')},EPSG:3857`;
    },
    strategy: bboxStrategy
});
const gsWfsLayer = new VectorLayer({
    source: gsWfsSource,
    style: localFeatureStyle,
    visible: false,
    zIndex: 90
});

[gsWmsImg50m, gsWmsImg50g, gsWmsShape1, gsWmsShape2, gsWmtsLayer, gsWfsLayer].forEach(l => map.addLayer(l));

// ── GeoServer 图层组（用于统一关闭） ─────────────────
const gsLayers = [gsWmsImg50m, gsWmsImg50g, gsWmsShape1, gsWmsShape2, gsWmtsLayer, gsWfsLayer];
let activeGsBtn = null;

function hideAllGs() {
    gsLayers.forEach(l => l.setVisible(false));
    if (activeGsBtn) { activeGsBtn.classList.remove('active'); activeGsBtn = null; }
}

// 各图层地理范围 [minLon, minLat, maxLon, maxLat]（EPSG:4326）
const GS_EXTENTS = {
    img50m: [108.362, 29.032, 116.131, 33.278],
    img50g: [73.487,  15.702, 135.087, 53.562]
};

window.loadGsWms = async (btn, key) => {
    hideAllGs();
    const layer = { img50m: gsWmsImg50m, img50g: gsWmsImg50g, shape1: gsWmsShape1, shape2: gsWmsShape2 }[key];
    if (!layer) return;
    layer.setVisible(true);
    btn.classList.add('active');
    activeGsBtn = btn;
    setGsStatus('WMS 图层已激活，正在加载瓦片…','loading');

    if (GS_EXTENTS[key]) {
        const ext3857 = transformExtent(GS_EXTENTS[key], 'EPSG:4326', 'EPSG:3857');
        map.getView().fit(ext3857, { padding: [40, 40, 40, 40], duration: 600 });
    }

    layer.getSource().once('tileloadend', () => setGsStatus('✓ WMS 加载成功','ok'));
    layer.getSource().once('tileloaderror', () => setGsStatus('✗ WMS 加载失败，请检查 GeoServer 是否运行','err'));
};

window.loadGsWmts = async (btn) => {
    hideAllGs();
    const layerName = document.getElementById('gs-wmts-layer')?.value || GS.layers.img50m;
    setGsStatus('正在获取 WMTS Capabilities…','loading');
    try {
        const resp = await fetch(`${GS.base}/gwc/service/wmts?REQUEST=GetCapabilities`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        const caps = new WMTSCapabilities().read(text);
        const options = optionsFromCapabilities(caps, { layer: layerName, matrixSet: 'EPSG:4326' })
                     || optionsFromCapabilities(caps, { layer: layerName, matrixSet: 'EPSG:900913' });
        if (!options) throw new Error(`图层 "${layerName}" 未找到，请检查图层名称`);
        // Capabilities 里的 URL 是绝对路径，替换为相对路径走 Vite 代理
        if (options.urls) {
            options.urls = options.urls.map(u => u.replace(/^https?:\/\/[^/]+/, ''));
        }
        gsWmtsLayer.setSource(new WMTS({ ...options, crossOrigin: 'anonymous' }));
        gsWmtsLayer.setVisible(true);
        btn.classList.add('active');
        activeGsBtn = btn;
        setGsStatus('✓ WMTS 加载成功','ok');
    } catch (e) {
        setGsStatus(`✗ ${e.message}`);
    }
};

window.loadGsWfs = (btn) => {
    if (gsWfsLayer.getVisible()) {
        gsWfsLayer.setVisible(false);
        gsWfsSource.clear();
        btn.classList.remove('active');
        setGsStatus('WFS 图层已关闭');
        return;
    }
    hideAllGs();
    gsWfsLayer.setVisible(true);
    btn.classList.add('active');
    activeGsBtn = btn;
    setGsStatus('WFS 正在按视图范围请求要素…','loading');

    gsWfsSource.clear();
    gsWfsSource.once('featuresloadend', () => {
        setGsStatus(`✓ WFS 已加载 ${gsWfsSource.getFeatures().length} 个要素`);
    });
    gsWfsSource.once('featuresloaderror', () => {
        setGsStatus('✗ WFS 加载失败，请检查 GeoServer 和图层名称');
    });
    // 触发加载（map.getSize() 在地图容器尺寸为 0 时返回 undefined，需保护）
    const size = map.getSize();
    if (!size || size[0] === 0 || size[1] === 0) {
        setGsStatus('✗ 地图容器尺寸异常，请展开工具栏后重试', 'err');
        return;
    }
    const ext = map.getView().calculateExtent(size);
    gsWfsSource.loadFeatures(ext, map.getView().getResolution(), map.getView().getProjection());
};

function setGsStatus(msg, type = '') {
    const el = document.getElementById('gs-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'status-msg' + (type ? ' ' + type : '');
}

