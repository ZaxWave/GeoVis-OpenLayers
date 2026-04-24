# GeoVis · OpenLayers 地图综合实习平台

本项目是基于 **OpenLayers 10** 和 **Node.js/Python** 开发的综合 WebGIS 平台，涵盖了从基础底图加载、GeoServer 服务集成到自定义 WFS 服务与瓦片生成的完整流程。

## 🚀 核心功能 (任务 1-12)

1.  **多源底图集成**：支持天地图、高德、百度、OSM、Bing 及 Google 地图的影像与矢量切换。
2.  **数据转换与加载**：实现 Shapefile 到 GeoJSON/KML 的转换与本地渲染。
3.  **GeoServer 集成**：支持 WMS、WFS 及 WMTS（含 50G 大数据量影像金字塔）服务加载。
4.  **动态交互**：
    * **无人机模拟**：支持航线绘制及无人机平滑沿线飞行动画。
    * **地图工具**：集成鹰眼、鼠标坐标实时显示及长度/面积测量控件。
5.  **自定义 GIS 后端**：利用 Python/Flask 实现符合 OGC 标准的 WFS 服务。
6.  **瓦片化技术**：提供脚本支持矢量瓦片 (MVT) 和栅格瓦片 (XYZ) 的离线生成与加载。

## 🛠️ 环境要求

- **Node.js**: 建议 v18+ (用于 Vite 前端开发)
- **Python**: 3.8+ (用于后端服务与切片脚本)
- **GeoServer**: 建议 2.2x+

## 📦 快速开始

### 1. 前端环境配置
```bash
npm install
npm run dev
```

### 2. Python 环境配置
```bash
python -m venv ol-env
.\ol-env\Scripts\activate
pip install -r requirements.txt
```

### 3. 运行服务
- **数据转换**：`node scripts/convert.mjs`
- **启动 WFS 服务**：`python wfs_server.py`
- **生成瓦片数据**：`python generate_tiles.py`

## 📄 开源协议
本项目采用 [MIT License](LICENSE) 协议。

