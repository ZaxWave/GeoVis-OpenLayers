import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        proxy: {
            // 天地图 POI
            '/api/poi/tianditu': {
                target: 'https://api.tianditu.gov.cn',
                changeOrigin: true,
                rewrite: path => path.replace('/api/poi/tianditu', '/v2/search')
            },
            // 高德 POI
            '/api/poi/gaode': {
                target: 'https://restapi.amap.com',
                changeOrigin: true,
                rewrite: path => path.replace('/api/poi/gaode', '/v3/place/text')
            },
            // 百度 POI
            '/api/poi/baidu': {
                target: 'https://api.map.baidu.com',
                changeOrigin: true,
                rewrite: path => path.replace('/api/poi/baidu', '/place/v2/search')
            },
            // GeoServer (解决 CORS，GeoServer 默认运行在 8080 端口)
            '/geoserver': {
                target: 'http://localhost:8080',
                changeOrigin: true
            },
            // Python WFS Server (Task 10，运行在 5000 端口)
            '/python-wfs': {
                target: 'http://localhost:5000',
                changeOrigin: true,
                rewrite: path => path.replace('/python-wfs', '/wfs')
            }
        }
    }
});
