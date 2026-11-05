import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import { C } from '../theme';
import { T } from './ui';
import { lite } from '../lib/perf';

export interface MapStop { id: string; n: number; lat: number; lng: number; label: string; done?: boolean; approx?: boolean; next?: boolean }
export interface MapData {
  stops: MapStop[]; me?: { lat: number; lng: number } | null; path?: [number, number][];
  /** Navigation: the road route to follow (dashed when it's only a straight line), the destination, and camera follow. */
  route?: [number, number][]; straight?: boolean; dest?: { lat: number; lng: number } | null;
  nav?: { follow: boolean; heading?: number | null } | null;
}

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
.maplibregl-ctrl-attrib,.leaflet-control-attribution{font-size:10px}.lf-icon{background:none;border:none}
.arrow{width:34px;height:34px;border-radius:17px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;box-sizing:border-box;border:2px solid #0a72d6}
.arrow i{width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:16px solid #0a72d6;margin-top:-3px}
.dest{width:34px;height:34px;border-radius:17px 17px 17px 3px;transform:rotate(-45deg);background:#d03b3b;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);box-sizing:border-box}
.dest:after{content:'';position:absolute;left:9px;top:9px;width:10px;height:10px;border-radius:5px;background:#fff}</style></head><body><div id="m"></div>
<script>
var post=function(o){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(o))};
var SIMPLE=${simple ? 'true' : 'false'};
var pending=null,loaded=false,impl=null;
window.setData=function(d){if(!loaded||!impl){pending=d;return}try{impl(d)}catch(e){post({type:'error',message:String(e)})}};
function ready(fn){impl=fn;loaded=true;post({type:'ready'});if(pending){var p=pending;pending=null;window.setData(p)}}
function css(h){var l=document.createElement('link');l.rel='stylesheet';l.href=h;document.head.appendChild(l)}
function js(src,ok){var s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=function(){post({type:'error',message:'could not load '+src})};document.head.appendChild(s)}
function gl2(){try{var c=document.createElement('canvas');return !!(window.WebGL2RenderingContext&&c.getContext('webgl2'))}catch(e){return false}}
function meEl(d){var e=document.createElement('div');if(d.nav){e.className='arrow';e.innerHTML='<i></i>';e.style.transform='rotate('+(d.nav.heading||0)+'deg)'}else e.className='me';return e}
function meHtml(d){return d.nav?'<div class="arrow" style="transform:rotate('+(d.nav.heading||0)+'deg)"><i></i></div>':'<div class="me"></div>'}
function destEl(){var e=document.createElement('div');e.className='dest';e.style.position='relative';return e}
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
    map.addSource('route',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'route-casing',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffffff','line-width':11}});
    map.addLayer({id:'route',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#0a72d6','line-width':7}});
    map.addLayer({id:'route-straight',type:'line',source:'route',filter:['==',['get','straight'],true],paint:{'line-color':'#d9822b','line-width':5,'line-dasharray':[1.5,1.5]}});
    map.on('dragstart',function(){post({type:'pan'})});
    var destMarker=null;
    ready(function(d){
     markers.forEach(function(m){m.remove()});markers=[];
     var b=new maplibregl.LngLatBounds(),any=false;
     d.stops.forEach(function(s){var el=document.createElement('div');el.className=pinClass(s);el.textContent=s.n;
      el.onclick=function(){post({type:'select',id:s.id})};
      markers.push(new maplibregl.Marker({element:el}).setLngLat([s.lng,s.lat]).addTo(map));b.extend([s.lng,s.lat]);any=true});
     if(meMarker){meMarker.remove();meMarker=null}
     if(d.me){meMarker=new maplibregl.Marker({element:meEl(d)}).setLngLat([d.me.lng,d.me.lat]).addTo(map);b.extend([d.me.lng,d.me.lat]);any=true}
     if(destMarker){destMarker.remove();destMarker=null}
     if(d.dest){destMarker=new maplibregl.Marker({element:destEl(),anchor:'bottom'}).setLngLat([d.dest.lng,d.dest.lat]).addTo(map);b.extend([d.dest.lng,d.dest.lat]);any=true}
     map.getSource('path').setData({type:'Feature',geometry:{type:'LineString',coordinates:(d.path||[]).map(function(p){return[p[1],p[0]]})}});
     var rc=(d.route||[]).map(function(p){return[p[1],p[0]]});
     map.getSource('route').setData(rc.length>1?{type:'Feature',properties:{straight:!!d.straight},geometry:{type:'LineString',coordinates:rc}}:{type:'FeatureCollection',features:[]});
     map.setLayoutProperty('route','visibility',d.straight?'none':'visible');map.setLayoutProperty('route-casing','visibility',d.straight?'none':'visible');
     rc.forEach(function(c){b.extend(c);any=true});
     if(d.nav&&d.nav.follow&&d.me){fitted=true;map.easeTo({center:[d.me.lng,d.me.lat],zoom:Math.max(map.getZoom(),16),duration:600})}
     else if(any&&!fitted){fitted=true;map.fitBounds(b,{padding:60,maxZoom:15,duration:0})}
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
   map.on('dragstart',function(){post({type:'pan'})});
   ready(function(d){
    layer.clearLayers();var pts=[];
    var line=(d.path||[]).map(function(p){return[p[0],p[1]]});
    if(line.length>1)L.polyline(line,{color:'#0a72d6',weight:4,opacity:.7,interactive:false}).addTo(layer);
    var rt=(d.route||[]).map(function(p){return[p[0],p[1]]});
    if(rt.length>1){if(d.straight)L.polyline(rt,{color:'#d9822b',weight:5,dashArray:'8 8',interactive:false}).addTo(layer);
     else{L.polyline(rt,{color:'#fff',weight:11,interactive:false}).addTo(layer);L.polyline(rt,{color:'#0a72d6',weight:7,interactive:false}).addTo(layer)}
     rt.forEach(function(c){pts.push(c)})}
    if(d.dest){L.marker([d.dest.lat,d.dest.lng],{interactive:false,icon:L.divIcon({className:'lf-icon',html:'<div class="dest" style="position:relative"></div>',iconSize:[34,34],iconAnchor:[6,40]})}).addTo(layer);pts.push([d.dest.lat,d.dest.lng])}
    d.stops.forEach(function(s){var z=s.next?36:30;
     var m=L.marker([s.lat,s.lng],{icon:L.divIcon({className:'lf-icon',html:'<div class="'+pinClass(s)+'">'+s.n+'</div>',iconSize:[z,z],iconAnchor:[z/2,z/2]})}).addTo(layer);
     m.on('click',function(){post({type:'select',id:s.id})});pts.push([s.lat,s.lng])});
    if(d.me){var z2=d.nav?34:16;L.marker([d.me.lat,d.me.lng],{interactive:false,icon:L.divIcon({className:'lf-icon',html:meHtml(d),iconSize:[z2,z2],iconAnchor:[z2/2,z2/2]})}).addTo(layer);pts.push([d.me.lat,d.me.lng])}
    if(d.nav&&d.nav.follow&&d.me){fitted=true;map.setView([d.me.lat,d.me.lng],Math.max(map.getZoom(),16),{animate:true})}
    else if(pts.length&&!fitted){fitted=true;if(pts.length===1)map.setView(pts[0],14);else map.fitBounds(pts,{padding:[50,50],maxZoom:14,animate:false})}
   });
  }catch(e){post({type:'error',message:String(e)})}
 });
}

if(!SIMPLE&&gl2())startLibre();else startLeaflet();
</script></body></html>`;

// react-native-webview's class typings don't line up with React 19's JSX types yet.
const WV = WebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebView> }>;

export function MapWeb({ data, onSelect, onPan, height = 300, offlineText, flat }: {
  data: MapData; onSelect?: (id: string) => void; onPan?: () => void; height?: number | '100%'; offlineText: string; flat?: boolean;
}) {
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
      else if (m.type === 'pan') onPan?.();
      else if (m.type === 'error' && !ready.current) setFailed(true);
    } catch { /* ignore */ }
  };

  return (
    <View style={flat ? { flex: 1, backgroundColor: '#e9eef5' } : { height, borderRadius: 18, overflow: 'hidden', backgroundColor: '#e9eef5', borderWidth: 1, borderColor: C.border }}>
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
