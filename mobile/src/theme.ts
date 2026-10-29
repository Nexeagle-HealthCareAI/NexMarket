// NexEagle field app — colours and sizes from the design canvas.
export const C = {
  ink: '#0e1525',
  ink2: '#1a2236',
  inkLine: '#3a4560',
  sideText: '#aeb7ca',
  bg: '#f4f6fa',
  card: '#ffffff',
  border: '#e3e6ee',
  borderStrong: '#d5dbe6',
  line: '#eef0f4',
  text: '#0f172a',
  text2: '#5a6478',
  text3: '#3a4252',
  muted: '#8a93a6',
  blue: '#0a72d6',
  blueInk: '#0a4e94',
  blueSoft: '#e6f2fd',
  mint: '#38f6a9',
  ok: '#0f8a5f',
  okInk: '#0b6b4a',
  okSoft: '#e7f6ef',
  warn: '#d9822b',
  warnInk: '#8a5100',
  warnSoft: '#fff4e0',
  bad: '#b42318',
  badSoft: '#fdecea',
  info: '#0e7490',
  infoInk: '#0e6178',
  infoSoft: '#e6f6fa',
  purple: '#5b3fb8',
  purpleSoft: '#efeafd',
  star: '#e2a400',
  starSoft: '#fff8e1',
};

export const R = { sm: 10, md: 14, lg: 18, xl: 24 };

export type Priority = 'very_high' | 'high' | 'normal' | 'low';

export const PRIORITY_COLOR: Record<Priority, { fg: string; bg: string; dot: string }> = {
  very_high: { fg: C.bad, bg: C.badSoft, dot: C.bad },
  high: { fg: C.warnInk, bg: C.warnSoft, dot: C.warn },
  normal: { fg: C.blueInk, bg: C.blueSoft, dot: C.blue },
  low: { fg: C.text2, bg: '#f1f2f5', dot: C.muted },
};
