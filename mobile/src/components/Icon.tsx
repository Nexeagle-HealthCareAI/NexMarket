import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'home' | 'users' | 'plus' | 'patients' | 'user' | 'globe' | 'map' | 'nav' | 'check' | 'phone' | 'whatsapp'
  | 'camera' | 'star' | 'back' | 'chevron' | 'close' | 'calendar' | 'clock' | 'upload' | 'alert' | 'note' | 'pin'
  | 'search' | 'refresh' | 'logout' | 'battery' | 'hospital' | 'flag' | 'cloudOff' | 'trash' | 'leave' | 'sparkle' | 'send'
  | 'chat' | 'attach' | 'smile' | 'tag' | 'doc' | 'image' | 'reply' | 'checks' | 'lock' | 'download' | 'pencil' | 'newChat' | 'bell' | 'bellOff' | 'settings'
  | 'fingerprint' | 'eye' | 'eyeOff' | 'backspace' | 'bolt'
  | 'turnLeft' | 'turnRight' | 'slightLeft' | 'slightRight' | 'straight' | 'uturn' | 'roundabout' | 'arrive' | 'volume' | 'volumeOff'
  | 'locate' | 'bike' | 'walk' | 'userPlus' | 'ambulance' | 'repeat' | 'route' | 'mic' | 'stop'
  | 'video' | 'videoOff' | 'micOff' | 'cameraFlip' | 'speaker' | 'phoneOff' | 'billboard';

/** Line icons drawn on a 24×24 grid, 2 px stroke, matching the design canvas. */
export function Icon({ name, size = 20, color = '#0f172a', strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body: React.ReactNode;
  switch (name) {
    case 'home': body = <><Path {...p} d="M3 11l9-7 9 7" /><Path {...p} d="M5 10v10h14V10" /><Path {...p} d="M10 20v-6h4v6" /></>; break;
    case 'users': body = <><Circle {...p} cx={9} cy={8} r={3.5} /><Path {...p} d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><Path {...p} d="M16 4.6a3.5 3.5 0 010 6.8M18 14.8c1.9.7 3.1 2.5 3.5 5.2" /></>; break;
    case 'plus': body = <><Path {...p} d="M12 5v14M5 12h14" /></>; break;
    case 'mic': body = <><Rect {...p} x={9} y={3} width={6} height={11} rx={3} /><Path {...p} d="M5 11a7 7 0 0014 0M12 18v3" /></>; break;
    case 'stop': body = <><Rect {...p} x={6} y={6} width={12} height={12} rx={2} /></>; break;
    case 'patients': body = <><Path {...p} d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" /><Path {...p} d="M9 11h6M12 8v6" /></>; break;
    case 'user': body = <><Circle {...p} cx={12} cy={8} r={4} /><Path {...p} d="M4 21c1-4 4.2-6 8-6s7 2 8 6" /></>; break;
    case 'globe': body = <><Circle {...p} cx={12} cy={12} r={9} /><Path {...p} d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>; break;
    case 'map': body = <><Path {...p} d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4z" /><Path {...p} d="M9 4v13.5M15 6.5V20" /></>; break;
    case 'nav': body = <><Path {...p} d="M3 11l18-8-8 18-2-8-8-2z" /></>; break;
    case 'check': body = <><Path {...p} d="M5 12.5l4.5 4.5L19 7.5" /></>; break;
    case 'phone': body = <><Path {...p} d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></>; break;
    case 'whatsapp': body = <><Path {...p} d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1112 20.5a8.4 8.4 0 01-4.2-1.1l-4.3 1.1z" /><Path {...p} d="M9 8.5c0 3.5 2.6 6.5 6.5 6.5l1-1.6-2-1-1 1c-1.2-.5-2.3-1.6-2.8-2.8l1-1-1-2L9 8.5z" /></>; break;
    case 'billboard': body = <><Rect {...p} x={3} y={4} width={18} height={10} rx={1.5} /><Path {...p} d="M8 14v6M16 14v6M7 8h10M7 11h6" /></>; break;
    case 'camera': body = <><Path {...p} d="M4 8h3l2-3h6l2 3h3v11H4z" /><Circle {...p} cx={12} cy={13} r={3.5} /></>; break;
    case 'star': body = <><Path {...p} d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" /></>; break;
    case 'back': body = <><Path {...p} d="M15 5l-7 7 7 7" /></>; break;
    case 'chevron': body = <><Path {...p} d="M9 5l7 7-7 7" /></>; break;
    case 'close': body = <><Path {...p} d="M6 6l12 12M18 6L6 18" /></>; break;
    case 'calendar': body = <><Rect {...p} x={3.5} y={5} width={17} height={15} rx={2} /><Path {...p} d="M3.5 10h17M8 3v4M16 3v4" /></>; break;
    case 'clock': body = <><Circle {...p} cx={12} cy={12} r={9} /><Path {...p} d="M12 7v5l3 2" /></>; break;
    case 'upload': body = <><Path {...p} d="M12 16V4M7 9l5-5 5 5" /><Path {...p} d="M4 16v4h16v-4" /></>; break;
    case 'alert': body = <><Path {...p} d="M12 3l10 18H2z" /><Path {...p} d="M12 10v5M12 18h.01" /></>; break;
    case 'note': body = <><Path {...p} d="M5 3h10l4 4v14H5z" /><Path {...p} d="M9 11h6M9 15h6M9 7h3" /></>; break;
    case 'pin': body = <><Path {...p} d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" /><Circle {...p} cx={12} cy={9.5} r={2.5} /></>; break;
    case 'search': body = <><Circle {...p} cx={11} cy={11} r={6.5} /><Path {...p} d="M16 16l4.5 4.5" /></>; break;
    case 'refresh': body = <><Path {...p} d="M20 11a8 8 0 10-2.3 5.7" /><Path {...p} d="M20 4v7h-7" /></>; break;
    case 'logout': body = <><Path {...p} d="M14 4h5v16h-5" /><Path {...p} d="M10 8l-4 4 4 4M6 12h10" /></>; break;
    case 'bolt': body = <><Path {...p} d="M13 3L5 14h6l-1 7 8-11h-6z" /></>; break;
    case 'battery': body = <><Rect {...p} x={3} y={7} width={16} height={10} rx={2} /><Path {...p} d="M21 10.5v3M7 10v4M10 10v4" /></>; break;
    case 'hospital': body = <><Path {...p} d="M4 21V7l8-4 8 4v14z" /><Path {...p} d="M12 9v6M9 12h6M10 21v-3h4v3" /></>; break;
    case 'flag': body = <><Path {...p} d="M5 21V4M5 4h11l-2 4 2 4H5" /></>; break;
    case 'cloudOff': body = <><Path {...p} d="M7 18h10a4 4 0 00.8-7.9A6 6 0 006.3 9 4.5 4.5 0 007 18z" /><Path {...p} d="M4 4l16 16" /></>; break;
    case 'trash': body = <><Path {...p} d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>; break;
    case 'sparkle': body = <><Path {...p} d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><Path {...p} d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>; break;
    case 'chat': body = <Path {...p} d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.9A8 8 0 1 1 21 12z" />; break;
    case 'bell': body = <><Path {...p} d="M6 9a6 6 0 0112 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" /><Path {...p} d="M10 20a2.2 2.2 0 004 0" /></>; break;
    case 'bellOff': body = <><Path {...p} d="M8.6 4.3A6 6 0 0118 9c0 3 .6 4.9 1.3 6M17 16.5H3.5S6 15 6 9c0-.5 0-1 .2-1.5" /><Path {...p} d="M10 20a2.2 2.2 0 004 0M3 3l18 18" /></>; break;
    case 'settings': body = <><Circle {...p} cx={12} cy={12} r={3} /><Path {...p} d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" /></>; break;
    case 'pencil': body = <><Path {...p} d="M4 20h4L19 9l-4-4L4 16v4z" /><Path {...p} d="M13.5 6.5l4 4" /></>; break;
    case 'newChat': body = <><Path {...p} d="M20 11.5a8 8 0 0 1-11.6 7.1L3 20l1.5-4.9A8 8 0 0 1 12 3.5" /><Path {...p} d="M18 3v6M15 6h6" /></>; break;
    case 'attach': body = <Path {...p} d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />; break;
    case 'smile': body = <><Circle {...p} cx={12} cy={12} r={9} /><Path {...p} d="M8 14.5a5 5 0 0 0 8 0M9 9.5h.01M15 9.5h.01" /></>; break;
    case 'tag': body = <><Path {...p} d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><Circle {...p} cx={7.5} cy={7.5} r={1.5} /></>; break;
    case 'doc': body = <><Path {...p} d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><Path {...p} d="M14 3v6h6M8 13h8M8 17h6" /></>; break;
    case 'image': body = <><Rect {...p} x={3} y={3} width={18} height={18} rx={3} /><Circle {...p} cx={8.5} cy={8.5} r={1.5} /><Path {...p} d="M21 15l-5-5L5 21" /></>; break;
    case 'reply': body = <Path {...p} d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v4" />; break;
    case 'checks': body = <Path {...p} d="M2 13l4 4L16 7M10 15l2 2L22 7" />; break;
    case 'lock': body = <><Rect {...p} x={4} y={11} width={16} height={10} rx={2} /><Path {...p} d="M8 11V7a4 4 0 0 1 8 0v4" /></>; break;
    case 'download': body = <Path {...p} d="M12 3v12m0 0l-5-5m5 5l5-5M4 21h16" />; break;
    case 'send': body = <><Path {...p} d="M4 12l16-8-6 16-2.5-6.5z" /><Path {...p} d="M11.5 13.5L20 4" /></>; break;
    case 'leave': body = <><Path {...p} d="M12 21c-4-3-7-6.5-7-11a7 7 0 0114 0c0 4.5-3 8-7 11z" /><Path {...p} d="M12 21V10" /></>; break;
    case 'fingerprint': body = <><Path {...p} d="M6.5 6.5A8 8 0 0 1 20 12v1" /><Path {...p} d="M4 12a8 8 0 0 1 1-3.9" /><Path {...p} d="M8 12a4 4 0 0 1 8 0v2a8 8 0 0 1-1.5 4.7" /><Path {...p} d="M12 12v2.5a12 12 0 0 1-2.4 6.5" /><Path {...p} d="M4.5 16a12 12 0 0 0 .5-4" /><Path {...p} d="M7.5 19.5A12 12 0 0 0 8 16" /></>; break;
    case 'eye': body = <><Path {...p} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><Circle {...p} cx={12} cy={12} r={3} /></>; break;
    case 'eyeOff': body = <><Path {...p} d="M3 3l18 18" /><Path {...p} d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><Path {...p} d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>; break;
    case 'backspace': body = <><Path {...p} d="M21 5H8l-6 7 6 7h13a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" /><Path {...p} d="M17 9l-6 6M11 9l6 6" /></>; break;
    case 'turnLeft': body = <><Path {...p} d="M17 20v-7a4 4 0 0 0-4-4H5" /><Path {...p} d="M9 5L5 9l4 4" /></>; break;
    case 'turnRight': body = <><Path {...p} d="M7 20v-7a4 4 0 0 1 4-4h8" /><Path {...p} d="M15 5l4 4-4 4" /></>; break;
    case 'slightLeft': body = <><Path {...p} d="M15 21v-7L7 6" /><Path {...p} d="M7 12V6h6" /></>; break;
    case 'slightRight': body = <><Path {...p} d="M9 21v-7l8-8" /><Path {...p} d="M17 12V6h-6" /></>; break;
    case 'straight': body = <><Path {...p} d="M12 21V4" /><Path {...p} d="M6 10l6-6 6 6" /></>; break;
    case 'uturn': body = <><Path {...p} d="M8 21V9a5 5 0 0 1 10 0v4" /><Path {...p} d="M14 10l4 4 4-4" /></>; break;
    case 'roundabout': body = <><Circle {...p} cx={12} cy={10} r={4} /><Path {...p} d="M12 14v7" /><Path {...p} d="M15 7l4-4M15 3h4v4" /></>; break;
    case 'arrive': body = <><Path {...p} d="M12 21c-4-3.6-7-7.2-7-11a7 7 0 0 1 14 0c0 3.8-3 7.4-7 11z" /><Path {...p} d="M9 10l2 2 4-4" /></>; break;
    case 'volume': body = <><Path {...p} d="M4 9h4l5-4v14l-5-4H4z" /><Path {...p} d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>; break;
    case 'volumeOff': body = <><Path {...p} d="M4 9h4l5-4v14l-5-4H4z" /><Path {...p} d="M17 9l5 6M22 9l-5 6" /></>; break;
    case 'locate': body = <><Circle {...p} cx={12} cy={12} r={7} /><Circle {...p} cx={12} cy={12} r={2.5} /><Path {...p} d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>; break;
    case 'bike': body = <><Circle {...p} cx={5.5} cy={16.5} r={3.5} /><Circle {...p} cx={18.5} cy={16.5} r={3.5} /><Path {...p} d="M5.5 16.5L9 9h6l3.5 7.5M9 9L7.5 6H5M15 9l-3 7.5h-6.5M15 9h3" /></>; break;
    case 'walk': body = <><Circle {...p} cx={13} cy={4.5} r={2} /><Path {...p} d="M9 21l3-7 3 3v4M7 12l3-4 4 1 3 3M12 14l-1-5" /></>; break;
    case 'userPlus': body = <><Circle {...p} cx={9} cy={8} r={4} /><Path {...p} d="M2 21c.8-4 3.6-6 7-6s6.2 2 7 6" /><Path {...p} d="M19 8v6M16 11h6" /></>; break;
    case 'ambulance': body = <><Path {...p} d="M2 17V8a1 1 0 0 1 1-1h11v10" /><Path {...p} d="M14 10h4l4 4v3h-2" /><Circle {...p} cx={7} cy={18} r={2} /><Circle {...p} cx={17} cy={18} r={2} /><Path {...p} d="M9 18h6M2 17h3M8 9v4M6 11h4" /></>; break;
    case 'repeat': body = <><Path {...p} d="M17 2l4 4-4 4" /><Path {...p} d="M3 12v-1a5 5 0 0 1 5-5h13" /><Path {...p} d="M7 22l-4-4 4-4" /><Path {...p} d="M21 12v1a5 5 0 0 1-5 5H3" /></>; break;
    case 'route': body = <><Circle {...p} cx={6} cy={19} r={2.5} /><Circle {...p} cx={18} cy={5} r={2.5} /><Path {...p} d="M8.5 19H17a3.5 3.5 0 0 0 0-7H7a3.5 3.5 0 0 1 0-7h8.5" /></>; break;
    case 'video': body = <><Rect {...p} x={2.5} y={6} width={13} height={12} rx={2.5} /><Path {...p} d="M15.5 10.5l6-3.5v10l-6-3.5" /></>; break;
    case 'videoOff': body = <><Path {...p} d="M10 6h3a2.5 2.5 0 012.5 2.5V12M15.5 15.5A2.5 2.5 0 0113 18H5a2.5 2.5 0 01-2.5-2.5v-7A2.5 2.5 0 015 6" /><Path {...p} d="M15.5 10.5l6-3.5v10l-3.5-2M2 2l20 20" /></>; break;
    case 'micOff': body = <><Path {...p} d="M15 10V6a3 3 0 00-5.7-1.3M9 9v2a3 3 0 004.6 2.5" /><Path {...p} d="M5 11a7 7 0 0011.3 5.5M19 11a7 7 0 01-.6 2.8M12 18v3M3 3l18 18" /></>; break;
    case 'cameraFlip': body = <><Path {...p} d="M4 8h3l2-3h6l2 3h3v11H4z" /><Path {...p} d="M9.5 12.5a2.7 2.7 0 014.8-1.2M14.5 14a2.7 2.7 0 01-4.8 1.2" /><Path {...p} d="M14.6 9.6v1.9h-1.9M9.4 17.1v-1.9h1.9" /></>; break;
    case 'speaker': body = <><Rect {...p} x={5} y={2.5} width={14} height={19} rx={3} /><Circle {...p} cx={12} cy={14} r={3.5} /><Path {...p} d="M12 6.5h.01" /></>; break;
    case 'phoneOff': body = <><Path {...p} d="M3.6 13.4a2 2 0 01-.5-2.2C5 7.7 8.3 6 12 6s7 1.7 8.9 5.2a2 2 0 01-.5 2.2l-1.7 1.4a1 1 0 01-1.3 0l-2.1-1.9a1 1 0 01-.3-.9l.3-1.6a10 10 0 00-6.6 0l.3 1.6a1 1 0 01-.3.9l-2.1 1.9a1 1 0 01-1.3 0z" /></>; break;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24">{body}</Svg>;
}
