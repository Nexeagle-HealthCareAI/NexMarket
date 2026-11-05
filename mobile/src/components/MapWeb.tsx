import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import { C } from '../theme';
import { T } from './ui';
import { lite } from '../lib/perf';

export interface MapStop { id: string; n: number; lat: number; lng: number; label: string; done?: boolean; approx?: boolean; next?: boolean }
export interface MapData { stops: MapStop[]; me?: { lat: number; lng: number } | null; path?: [number, number][] }

/**
 * Route map in a WebView. Two engines, same pins and route line:
 *  - MapLibre GL JS with OpenFreeMap's free "liberty" style (no API key) on phones whose WebView has WebGL 2;
 *  - Leaflet with plain OpenStreetMap picture tiles on older phones (no WebGL 2) and in light mode. It is much
 *    lighter on memory and works on old WebViews.
 * Needs internet for tiles; when it fails the screen's list still works.
 */
const html = (simple: boolean) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body,#m{margin:0;height:100%;background:#e9eef5;font-family:sans-serif}
.pin{width:30px;height:30px;border-radius:15px;background:#0a72d6;color:#fff;font:700 14px sans-serif;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);box-sizing:border-box}
.pin.done{background:#0f8a5f}.pin.approx{background:#8a93a6}.pin.next{background:#d9822b;width:36px;height:36px;border-radius:18px}
.me{width:16px;height:16px;border-radius:8px;background:#0a72d6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(10,114,214,.25);box-sizing:border-box}
.maplibregl-ctrl-attrib,.leaflet-control-attribution{font-size:10px}.lf-icon{background:none;border:none}</style></head><body><div id="m"></div>
<script>
var post=function(o){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(o))};
var SIMPLE=${simple ? 'true' : 'false'};
var pending=null,loaded=false,impl=null;
window.setData=function(d){if(!loaded||!impl){pending=d;return}try{impl(d)}catch(e){post({type:'error',message:String(e)})}};
function ready(fn){impl=fn;loaded=true;post({type:'ready'});if(pending){var p=pending;pending=null;window.setData(p)}}
function css(h){var l=document.createElement('link');l.rel='stylesheet';l.href=h;document.head.appendChild(l)}
function js(src,ok){var s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=function(){post({type:'error',message:'could not load '+src})};document.head.appendChild(s)}
function gl2(){try{var c=document.createElement('canvas');return !!(window.WebGL2RenderingContext&&c.getContext('webgl2'))}catch(e){return false}}
function pinClass(s){return 'pin'+(s.done?' done':'')+(s.approx?' approx':'')+(s.next?' next':'')}

function startLibre(){
 css('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css');
 js('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',function(){
  try{
   var map=new maplibregl.Map({container:'m',style:'https://tiles.openfreemap.org/styles/liberty',center:[87.95,26.1],zoom:9,attributionControl:{compact:true}});
   var markers=[],meMarker=null,fitted=false;
   map.on('error',function(e){post({type:'error',message:String(e&&e.error&&e.error.message||'map error')})});
   map.on('load',function(){
    map.addSource('path',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'path',type:'line',source:'path',paint:{'line-color':'#0a72d6','line-width':4,'line-opacity':.7}});
    ready(function(d){
     markers.forEach(function(m){m.remove()});markers=[];
     var b=new maplibregl.LngLatBounds(),any=false;
     d.stops.forEach(function(s){var el=document.createElement('div');el.className=pinClass(s);el.textContent=s.n;
      el.onclick=function(){post({type:'select',id:s.id})};
      markers.push(new maplibregl.Marker({element:el}).setLngLat([s.lng,s.lat]).addTo(map));b.extend([s.lng,s.lat]);any=true});
     if(meMarker){meMarker.remove();meMarker=null}
     if(d.me){var e=document.createElement('div');e.className='me';meMarker=new maplibregl.Marker({element:e}).setLngLat([d.me.lng,d.me.lat]).addTo(map);b.extend([d.me.lng,d.me.lat]);any=true}
     map.getSource('path').setData({type:'Feature',geometry:{type:'LineString',coordinates:(d.path||[]).map(function(p){return[p[1],p[0]]})}});
     if(any&&!fitted){fitted=true;map.fitBounds(b,{padding:50,maxZoom:14,duration:0})}
    });
   });
  }catch(e){post({type:'error',message:String(e)})}
 });
}

function startLeaflet(){
 css('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
 js('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',function(){
  try{
   var map=L.map('m',{zoomControl:false,preferCanvas:true,fadeAnimation:false,markerZoomAnimation:false}).setView([26.1,87.95],9);
   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap',keepBuffer:1,updateWhenIdle:true}).addTo(map);
   var layer=L.layerGroup().addTo(map),fitted=false;
   ready(function(d){
    layer.clearLayers();var pts=[];
    var line=(d.path||[]).map(function(p){return[p[0],p[1]]});
    if(line.length>1)L.polyline(line,{color:'#0a72d6',weight:4,opacity:.7,interactive:false}).addTo(layer);
    d.stops.forEach(function(s){var z=s.next?36:30;
     var m=L.marker([s.lat,s.lng],{icon:L.divIcon({className:'lf-icon',html:'<div class="'+pinClass(s)+'">'+s.n+'</div>',iconSize:[z,z],iconAnchor:[z/2,z/2]})}).addTo(layer);
     m.on('click',function(){post({type:'select',id:s.id})});pts.push([s.lat,s.lng])});
    if(d.me){L.marker([d.me.lat,d.me.lng],{interactive:false,icon:L.divIcon({className:'lf-icon',html:'<div class="me"></div>',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(layer);pts.push([d.me.lat,d.me.lng])}
    if(pts.length&&!fitted){fitted=true;if(pts.length===1)map.setView(pts[0],14);else map.fitBounds(pts,{padding:[50,50],maxZoom:14,animate:false})}
   });
  }catch(e){post({type:'error',message:String(e)})}
 });
}

if(!SIMPLE&&gl2())startLibre();else startLeaflet();
</script></body></html>`;

// react-native-webview's class typings don't line up with React 19's JSX types yet.
const WV = WebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebView> }>;

export function MapWeb({ data, onSelect, height = 300, offlineText }: { data: MapData; onSelect?: (id: string) => void; height?: number; offlineText: string }) {
  const ref = useRef<WebView>(null);
  const [failed, setFailed] = useState(false);
  const json = useMemo(() => JSON.stringify(data), [data]);
  const ready = useRef(false);
  const source = useMemo(() => ({ html: html(lite()), baseUrl: 'https://nexeagle.com' }), []);

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
        <WV ref={ref} originWhitelist={['*']} source={source} onMessage={onMessage}
          onError={() => setFailed(true)} javaScriptEnabled domStorageEnabled setSupportMultipleWindows={false}
          style={{ backgroundColor: 'transparent' }} />
      )}
    </View>
  );
}
