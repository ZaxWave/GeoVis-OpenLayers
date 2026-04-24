// Task 7 / 8 / 9  — 导出供 main.js 调用
import { Map } from 'ol';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Draw from 'ol/interaction/Draw';
import { getLength, getArea } from 'ol/sphere';
import { unByKey } from 'ol/Observable';
import OverviewMap from 'ol/control/OverviewMap';
import MousePosition from 'ol/control/MousePosition';
import ScaleLine from 'ol/control/ScaleLine';
import { createStringXY } from 'ol/coordinate';
import Overlay from 'ol/Overlay';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import Icon from 'ol/style/Icon';

// ── 无人机 SVG（指向上方 = 北） ────────────────────────────
const DRONE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <line x1="24" y1="24" x2="6"  y2="6"  stroke="#8ba4c8" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="24" y1="24" x2="42" y2="6"  stroke="#8ba4c8" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="24" y1="24" x2="6"  y2="42" stroke="#8ba4c8" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="24" y1="24" x2="42" y2="42" stroke="#8ba4c8" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="6"  cy="6"  r="5.5" fill="rgba(79,142,247,0.2)" stroke="#4f8ef7" stroke-width="1.5"/>
  <circle cx="42" cy="6"  r="5.5" fill="rgba(79,142,247,0.2)" stroke="#4f8ef7" stroke-width="1.5"/>
  <circle cx="6"  cy="42" r="5.5" fill="rgba(79,142,247,0.2)" stroke="#4f8ef7" stroke-width="1.5"/>
  <circle cx="42" cy="42" r="5.5" fill="rgba(79,142,247,0.2)" stroke="#4f8ef7" stroke-width="1.5"/>
  <circle cx="24" cy="24" r="5"   fill="#0f172a" stroke="#4f8ef7" stroke-width="2"/>
  <polygon points="24,9 21,17 24,15 27,17" fill="#f59e0b"/>
</svg>`;
const DRONE_ICON_URL = 'data:image/svg+xml,' + encodeURIComponent(DRONE_SVG);

function droneStyle(rotation = 0) {
    return new Style({
        image: new Icon({ src: DRONE_ICON_URL, rotation, scale: 0.9, anchor: [0.5, 0.5] })
    });
}

export function initTasks(map) {

    // ══════════════════════════════════════════════
    //  Task 9A — 控件
    // ══════════════════════════════════════════════
    map.addControl(new MousePosition({
        coordinateFormat: createStringXY(5),
        projection: 'EPSG:4326',
        target: document.getElementById('mouse-position'),
        undefinedHTML: '—'
    }));

    map.addControl(new ScaleLine({
        units: 'metric',
        target: document.getElementById('scale-line')
    }));

    map.addControl(new OverviewMap({
        layers: [new TileLayer({ source: new OSM() })],
        collapsed: false,
        collapsible: true,
        tipLabel: '鹰眼'
    }));

    // ══════════════════════════════════════════════
    //  Task 7 — 无人机飞行
    // ══════════════════════════════════════════════
    const routeSource = new VectorSource();
    const droneSource = new VectorSource();
    map.addLayer(new VectorLayer({
        source: routeSource,
        style: new Style({ stroke: new Stroke({ color: '#4f8ef7', width: 2.5, lineDash: [8, 5] }) }),
        zIndex: 150
    }));
    map.addLayer(new VectorLayer({ source: droneSource, zIndex: 200 }));

    let droneFeature = null, animId = null, paused = false, elapsed = 0;
    let drawInteraction = null;

    function stopAnim() {
        if (animId) { cancelAnimationFrame(animId); animId = null; }
        paused = false; elapsed = 0;
    }

    function updateFlyBtn(state) {
        const btn = document.getElementById('drone-fly-btn');
        if (!btn) return;
        btn.textContent = { idle: '开始飞行', ready: '开始飞行', flying: '暂停', paused: '继续' }[state] || '开始飞行';
        btn.disabled = state === 'idle';
    }

    window.startDrawRoute = () => {
        stopAnim(); routeSource.clear(); droneSource.clear();
        if (drawInteraction) map.removeInteraction(drawInteraction);
        drawInteraction = new Draw({ source: routeSource, type: 'LineString' });
        map.addInteraction(drawInteraction);
        setStatus('drone', '点击地图绘制航线节点，双击结束');
        drawInteraction.on('drawend', (e) => {
            map.removeInteraction(drawInteraction); drawInteraction = null;
            const coords = e.feature.getGeometry().getCoordinates();
            droneFeature = new Feature({ geometry: new Point(coords[0]) });
            droneFeature.setStyle(droneStyle());
            droneSource.addFeature(droneFeature);
            setStatus('drone', `航线 ${coords.length} 个节点，可开始飞行`);
            updateFlyBtn('ready');
        });
    };

    window.toggleDrone = () => {
        if (!droneFeature) return;
        const line = routeSource.getFeatures()[0]?.getGeometry();
        if (!line) return;

        if (animId && !paused) {
            paused = true; cancelAnimationFrame(animId); animId = null;
            updateFlyBtn('paused'); setStatus('drone', '已暂停'); return;
        }

        paused = false;
        const duration = (line.getLength() / 80) * 1000; // 80 m/s
        let frameStart = null;

        function step(ts) {
            if (!frameStart) frameStart = ts - elapsed;
            elapsed = ts - frameStart;
            const frac = Math.min(elapsed / duration, 1);
            const pos  = line.getCoordinateAt(frac);
            const npos = line.getCoordinateAt(Math.min(frac + 0.002, 1));
            droneFeature.setGeometry(new Point(pos));
            droneFeature.setStyle(droneStyle(Math.atan2(npos[0] - pos[0], npos[1] - pos[1])));
            map.render();
            if (frac < 1) { animId = requestAnimationFrame(step); }
            else { elapsed = 0; animId = null; updateFlyBtn('ready'); setStatus('drone', '飞行完成'); }
        }
        animId = requestAnimationFrame(step);
        updateFlyBtn('flying'); setStatus('drone', '飞行中…');
    };

    window.resetDrone = () => {
        stopAnim(); routeSource.clear(); droneSource.clear();
        droneFeature = null; updateFlyBtn('idle'); setStatus('drone', '');
    };

    // ══════════════════════════════════════════════
    //  Task 8 — 地图标注
    // ══════════════════════════════════════════════
    const annotateSource = new VectorSource();
    map.addLayer(new VectorLayer({ source: annotateSource, zIndex: 180 }));

    let annotateMode = false, pendingCoord = null;
    const annPopupEl = document.getElementById('annotate-popup');
    const annOverlay = new Overlay({ element: annPopupEl, positioning: 'bottom-center', stopEvent: true, offset: [0, -14] });
    map.addOverlay(annOverlay);

    window.toggleAnnotate = (btn) => {
        annotateMode = !annotateMode;
        btn.classList.toggle('active', annotateMode);
        map.getTargetElement().style.cursor = annotateMode ? 'crosshair' : '';
        setStatus('annotate', annotateMode ? '点击地图放置标注' : '');
        if (!annotateMode) annOverlay.setPosition(undefined);
    };

    map.on('singleclick', (evt) => {
        if (!annotateMode) return;
        const hit = map.forEachFeatureAtPixel(evt.pixel, f => f);
        if (hit) return;
        pendingCoord = evt.coordinate;
        document.getElementById('annotate-text').value = '';
        annOverlay.setPosition(pendingCoord);
        setTimeout(() => document.getElementById('annotate-text')?.focus(), 60);
    });

    window.confirmAnnotation = () => {
        const text = document.getElementById('annotate-text')?.value.trim();
        if (!text || !pendingCoord) { annOverlay.setPosition(undefined); return; }
        const f = new Feature({ geometry: new Point(pendingCoord), label: text });
        f.setStyle(new Style({
            image: new CircleStyle({ radius: 5, fill: new Fill({ color: '#f59e0b' }), stroke: new Stroke({ color: '#fff', width: 1.5 }) }),
            text: new Text({
                text,
                offsetY: -18,
                font: '600 12px Inter, sans-serif',
                fill: new Fill({ color: '#fff' }),
                stroke: new Stroke({ color: '#0f172a', width: 3 }),
                backgroundFill: new Fill({ color: 'rgba(15,23,42,0.75)' }),
                padding: [3, 6, 3, 6]
            })
        }));
        annotateSource.addFeature(f);
        annOverlay.setPosition(undefined);
        pendingCoord = null;
    };

    window.cancelAnnotation  = () => { annOverlay.setPosition(undefined); pendingCoord = null; };
    window.clearAnnotations  = () => { annotateSource.clear(); setStatus('annotate', '标注已清除'); };

    // ══════════════════════════════════════════════
    //  Task 9B — 测量控件
    // ══════════════════════════════════════════════
    const measureSource = new VectorSource();
    map.addLayer(new VectorLayer({
        source: measureSource,
        style: new Style({
            fill: new Fill({ color: 'rgba(79,142,247,0.1)' }),
            stroke: new Stroke({ color: '#4f8ef7', width: 2 }),
            image: new CircleStyle({ radius: 4, fill: new Fill({ color: '#4f8ef7' }) })
        }),
        zIndex: 170
    }));

    const tipEl = document.createElement('div');
    tipEl.className = 'measure-tip';
    const tipOverlay = new Overlay({ element: tipEl, offset: [14, 0], positioning: 'center-left' });
    map.addOverlay(tipOverlay);

    let mDraw = null, mListener = null, activeMBtn = null;

    function fmt(geom) {
        if (geom.getType() === 'LineString') {
            const m = getLength(geom, { projection: 'EPSG:3857' });
            return m > 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
        }
        const m2 = getArea(geom, { projection: 'EPSG:3857' });
        return m2 > 1e6 ? `${(m2 / 1e6).toFixed(3)} km²` : `${m2.toFixed(0)} m²`;
    }

    window.startMeasure = (btn, type) => {
        if (mDraw) { map.removeInteraction(mDraw); if (mListener) unByKey(mListener); mDraw = null; }
        if (activeMBtn) activeMBtn.classList.remove('active');
        if (activeMBtn === btn) { activeMBtn = null; tipOverlay.setPosition(undefined); setStatus('measure', ''); return; }

        activeMBtn = btn; btn.classList.add('active');
        mDraw = new Draw({ source: measureSource, type });
        map.addInteraction(mDraw);
        setStatus('measure', type === 'LineString' ? '点击起点，双击结束测距' : '点击起点，双击结束测面积');

        mDraw.on('drawstart', (e) => {
            mListener = e.feature.getGeometry().on('change', (ev) => {
                tipEl.textContent = fmt(ev.target);
                const c = ev.target.getType() === 'LineString'
                    ? ev.target.getLastCoordinate()
                    : ev.target.getInteriorPoint().getCoordinates();
                tipOverlay.setPosition(c);
            });
        });

        mDraw.on('drawend', (e) => {
            const result = fmt(e.feature.getGeometry());
            if (mListener) unByKey(mListener);
            tipEl.textContent = '';
            tipOverlay.setPosition(undefined);
            map.removeInteraction(mDraw); mDraw = null;
            btn.classList.remove('active'); activeMBtn = null;
            setStatus('measure', `结果：${result}（已保留在地图）`);
        });
    };

    window.clearMeasure = () => {
        if (mDraw) { map.removeInteraction(mDraw); if (mListener) unByKey(mListener); mDraw = null; }
        measureSource.clear(); tipOverlay.setPosition(undefined);
        if (activeMBtn) { activeMBtn.classList.remove('active'); activeMBtn = null; }
        setStatus('measure', '');
    };
}

function setStatus(tool, msg) {
    const el = document.getElementById(`${tool}-status`);
    if (el) el.textContent = msg;
}
