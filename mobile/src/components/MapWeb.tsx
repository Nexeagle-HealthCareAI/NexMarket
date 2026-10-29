import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import { C } from '../theme';
import { T } from './ui';

export interface MapStop { id: string; n: number; lat: number; lng: number; label: string; done?: boolean; approx?: boolean; next?: boolean }
export interface MapData { stops: MapStop[]; me?: { lat: number; lng: number } | null; path?: [number, number][] }

/**
 * Route map: MapLibre GL JS in a WebView, with OpenFreeMap's free "liberty" style (no
 * API key). Needs internet for tiles; when it fails the screen's list still works.
 */
const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet">
<style>html,body,#m{margin:0;height:100%;background:#e9eef5;font-family:sans-serif}
.pin{width:30px;height:30px;border-radius:15px;background:#0a72d6;color:#fff;font:700 14px sans-serif;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)}
.pin.done{background:#0f8a5f}.pin.approx{background:#8a93a6}.pin.next{background:#d9822b;width:36px;height:36px;border-radius:18px}
.me{width:16px;height:16px;border-radius:8px;background:#0a72d6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(10,114,214,.25)}
.maplibregl-ctrl-attrib{font-size:10px}</style></head><body><div id="m"></div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
var post=function(o){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(o))};
var map,markers=[],meMarker=null,pending=null,loaded=false;
try{
 map=new maplibregl.Map({container:'m',style:'https://tiles.openfreemap.org/styles/liberty',center:[87.95,26.1],zoom:9,attributionControl:{compact:true}});
 map.on('load',function(){loaded=true;map.addSource('path',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'path',type:'line',source:'path',paint:{'line-color':'#0a72d6','line-width':4,'line-opacity':.7}});
  post({type:'ready'}); if(pending){window.setData(pending);pending=null}});
 map.on('error',function(e){post({type:'error',message:String(e&&e.error&&e.error.message||'map error')})});
}catch(e){post({type:'error',message:String(e)})}
window.setData=function(d){
 if(!loaded){pending=d;return}
 markers.forEach(function(m){m.remove()});markers=[];
 var b=new maplibregl.LngLatBounds();var any=false;
 d.stops.forEach(function(s){var el=document.createElement('div');el.className='pin'+(s.done?' done':'')+(s.approx?' approx':'')+(s.next?' next':'');el.textContent=s.n;
  el.onclick=function(){post({type:'select',id:s.id})};
  markers.push(new maplibregl.Marker({element:el}).setLngLat([s.lng,s.lat]).addTo(map));b.extend([s.lng,s.lat]);any=true});
 if(meMarker){meMarker.remove();meMarker=null}
 if(d.me){var e=document.createElement('div');e.className='me';meMarker=new maplibregl.Marker({element:e}).setLngLat([d.me.lng,d.me.lat]).addTo(map);b.extend([d.me.lng,d.me.lat]);any=true}
 map.getSource('path').setData({type:'Feature',geometry:{type:'LineString',coordinates:(d.path||[]).map(function(p){return[p[1],p[0]]})}});
 if(any&&!window.__fitted){window.__fitted=true;map.fitBounds(b,{padding:50,maxZoom:14,duration:0})}
};
</script></body></html>`;

// react-native-webview's class typings don't line up with React 19's JSX types yet.
const WV = WebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebView> }>;

export function MapWeb({ data, onSelect, height = 300, offlineText }: { data: MapData; onSelect?: (id: string) => void; height?: number; offlineText: string }) {
  const ref = useRef<WebView>(null);
  const [failed, setFailed] = useState(false);
  const json = useMemo(() => JSON.stringify(data), [data]);
  const ready = useRef(false);

  useEffect(() => {
    if (ready.current) ref.current?.injectJavaScript(`window.setData(${json});true;`);
  }, [json]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data) as { type: string; id?: string };
      if (m.type === 'ready') {
        ready.current = true;
        ref.current?.injectJavaScript(`window.setData(${json});true;`);
      } else if (m.type === 'select' && m.id) onSelect?.(m.id);
      else if (m.type === 'error' && !ready.current) setFailed(true);
    } catch { /* ignore */ }
  };

  return (
    <View style={{ height, borderRadius: 18, overflow: 'hidden', backgroundColor: '#e9eef5', borderWidth: 1, borderColor: C.border }}>
      {failed ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <T style={{ color: C.text2, textAlign: 'center' }}>{offlineText}</T>
        </View>
      ) : (
        <WV ref={ref} originWhitelist={['*']} source={{ html: HTML, baseUrl: 'https://localhost' }} onMessage={onMessage}
          onError={() => setFailed(true)} javaScriptEnabled domStorageEnabled setSupportMultipleWindows={false}
          style={{ backgroundColor: 'transparent' }} />
      )}
    </View>
  );
}
