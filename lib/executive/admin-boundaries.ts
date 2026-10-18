import type { Layer, WMSOptions } from 'leaflet';

// VWorld WMS administrative-boundary overlay. The project key has this service enabled;
// lt_c_adsigg (si/gun/gu) + lt_c_adsido (si/do) render as transparent dashed PNGs in the map's own EPSG:3857.
export function createAdminBoundaryLayer(L: typeof import('leaflet'), apiKey: string): Layer {
  const options = {
    key: apiKey,
    layers: 'lt_c_adsigg,lt_c_adsido',
    styles: '',
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    maxZoom: 19,
    opacity: 0.95,
  } as WMSOptions;
  return L.tileLayer.wms('https://api.vworld.kr/req/wms', options);
}
