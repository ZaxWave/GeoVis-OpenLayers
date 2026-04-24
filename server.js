// 开发代理服务器（Vite dev 模式已通过 vite.config.js 内置代理，无需此文件）
// 如需生产环境或单独运行，请先安装：npm install express axios cors
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());

// 天地图 POI（透传所有查询参数）
app.get('/api/poi/tianditu', async (req, res) => {
    try {
        const r = await axios.get('https://api.tianditu.gov.cn/v2/search', { params: req.query });
        res.json(r.data);
    } catch (e) { res.status(500).json({ msg: e.message }); }
});

// 高德 POI（透传所有查询参数，密钥在前端 KEY.gaode 中）
app.get('/api/poi/gaode', async (req, res) => {
    try {
        const r = await axios.get('https://restapi.amap.com/v3/place/text', { params: req.query });
        res.json(r.data);
    } catch (e) { res.status(500).json({ status: '0', info: e.message }); }
});

// 百度 POI（透传所有查询参数，密钥在前端 KEY.baidu 中）
app.get('/api/poi/baidu', async (req, res) => {
    try {
        const r = await axios.get('https://api.map.baidu.com/place/v2/search', { params: req.query });
        res.json(r.data);
    } catch (e) { res.status(500).json({ status: 1, message: e.message }); }
});

app.listen(3000, () => console.log('GIS Proxy running on http://localhost:3000'));
