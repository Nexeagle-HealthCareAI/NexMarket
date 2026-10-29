import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'home' | 'users' | 'plus' | 'patients' | 'user' | 'globe' | 'map' | 'nav' | 'check' | 'phone' | 'whatsapp'
  | 'camera' | 'star' | 'back' | 'chevron' | 'close' | 'calendar' | 'clock' | 'upload' | 'alert' | 'note' | 'pin'
  | 'search' | 'refresh' | 'logout' | 'battery' | 'hospital' | 'flag' | 'cloudOff' | 'trash' | 'leave' | 'sparkle' | 'send';

/** Line icons drawn on a 24×24 grid, 2 px stroke, matching the design canvas. */
export function Icon({ name, size = 20, color = '#0f172a', strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body: React.ReactNode;
  switch (name) {
    case 'home': body = <><Path {...p} d="M3 11l9-7 9 7" /><Path {...p} d="M5 10v10h14V10" /><Path {...p} d="M10 20v-6h4v6" /></>; break;
    case 'users': body = <><Circle {...p} cx={9} cy={8} r={3.5} /><Path {...p} d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><Path {...p} d="M16 4.6a3.5 3.5 0 010 6.8M18 14.8c1.9.7 3.1 2.5 3.5 5.2" /></>; break;
    case 'plus': body = <><Path {...p} d="M12 5v14M5 12h14" /></>; break;
    case 'patients': body = <><Path {...p} d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" /><Path {...p} d="M9 11h6M12 8v6" /></>; break;
    case 'user': body = <><Circle {...p} cx={12} cy={8} r={4} /><Path {...p} d="M4 21c1-4 4.2-6 8-6s7 2 8 6" /></>; break;
    case 'globe': body = <><Circle {...p} cx={12} cy={12} r={9} /><Path {...p} d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>; break;
    case 'map': body = <><Path {...p} d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4z" /><Path {...p} d="M9 4v13.5M15 6.5V20" /></>; break;
    case 'nav': body = <><Path {...p} d="M3 11l18-8-8 18-2-8-8-2z" /></>; break;
    case 'check': body = <><Path {...p} d="M5 12.5l4.5 4.5L19 7.5" /></>; break;
    case 'phone': body = <><Path {...p} d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></>; break;
    case 'whatsapp': body = <><Path {...p} d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1112 20.5a8.4 8.4 0 01-4.2-1.1l-4.3 1.1z" /><Path {...p} d="M9 8.5c0 3.5 2.6 6.5 6.5 6.5l1-1.6-2-1-1 1c-1.2-.5-2.3-1.6-2.8-2.8l1-1-1-2L9 8.5z" /></>; break;
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
    case 'battery': body = <><Rect {...p} x={3} y={7} width={16} height={10} rx={2} /><Path {...p} d="M21 10.5v3M7 10v4M10 10v4" /></>; break;
    case 'hospital': body = <><Path {...p} d="M4 21V7l8-4 8 4v14z" /><Path {...p} d="M12 9v6M9 12h6M10 21v-3h4v3" /></>; break;
    case 'flag': body = <><Path {...p} d="M5 21V4M5 4h11l-2 4 2 4H5" /></>; break;
    case 'cloudOff': body = <><Path {...p} d="M7 18h10a4 4 0 00.8-7.9A6 6 0 006.3 9 4.5 4.5 0 007 18z" /><Path {...p} d="M4 4l16 16" /></>; break;
    case 'trash': body = <><Path {...p} d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>; break;
    case 'sparkle': body = <><Path {...p} d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><Path {...p} d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>; break;
    case 'send': body = <><Path {...p} d="M4 12l16-8-6 16-2.5-6.5z" /><Path {...p} d="M11.5 13.5L20 4" /></>; break;
    case 'leave': body = <><Path {...p} d="M12 21c-4-3-7-6.5-7-11a7 7 0 0114 0c0 4.5-3 8-7 11z" /><Path {...p} d="M12 21V10" /></>; break;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24">{body}</Svg>;
}
