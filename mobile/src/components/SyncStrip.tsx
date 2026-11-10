import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { T } from './ui';
import { useDb, useSession, useSync } from '../lib/session';
import { kvGet, q } from '../lib/db';
import { syncNow } from '../lib/sync';
import { pendingCount, useChatVersion } from '../lib/chat';
import { timeOf } from '../lib/format';

export type SyncLevel = 'ok' | 'wait' | 'off';

const LOOK: Record<SyncLevel, { bg: string; fg: string }> = {
  ok: { bg: '#e7f6ef', fg: '#0b6b4a' },
  wait: { bg: '#fff4e0', fg: '#8a5100' },
  off: { bg: '#fdecea', fg: '#9a1c12' },
};

/** What the strip shows: work and chat messages still on the phone, signal, and the last good send. */
export function useSyncSummary(): { level: SyncLevel; waiting: number; running: boolean; lastAt: string | null } {
  const sync = useSync();
  useChatVersion();
  const d = useDb(() => ({ outbox: q.outboxCount(), last: kvGet('lastSyncAt') }));
  const waiting = d.outbox + pendingCount();
  const level: SyncLevel = !sync.online ? 'off' : waiting > 0 ? 'wait' : 'ok';
  return { level, waiting, running: sync.running, lastAt: sync.lastOkAt ?? d.last };
}

/**
 * Send-status strip (44 px) for under a screen header: green "Everything is sent · 9:51 am", amber "3 waiting to send",
 * red "No signal – saved on your phone". Tapping it sends now. Use <TopBar status /> or place it yourself.
 */
export function SyncStrip({ style, onPress }: { style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const { t, lang } = useSession();
  const { level, waiting, running, lastAt } = useSyncSummary();
  const { bg, fg } = LOOK[level];
  const label = level === 'off' ? t('uxSyncOff') : level === 'wait' ? t('uxSyncWait', { n: waiting }) : t('uxSyncOk');
  const side = running ? t('uxSyncSending')
    : level === 'off' ? (waiting > 0 ? t('nOnPhone', { n: waiting }) : '')
      : level === 'wait' ? t('uxSyncTap')
        : lastAt ? timeOf(lang, lastAt) : '';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={side ? `${label}, ${side}` : label} accessibilityState={{ busy: running }}
      onPress={onPress ?? (() => { void syncNow(true); })}
      style={({ pressed }) => [{ minHeight: 44, paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: bg }, pressed && { opacity: 0.85 }, style]}>
      <StripIcon level={level} color={fg} />
      <T style={{ flex: 1, color: fg, fontSize: 14, fontWeight: '700' }} numberOfLines={2}>{label}</T>
      {side ? <T style={{ color: fg, fontSize: 14, fontWeight: '600', opacity: 0.9 }} numberOfLines={1}>{side}</T> : null}
    </Pressable>
  );
}

function StripIcon({ level, color }: { level: SyncLevel; color: string }) {
  const p = { stroke: color, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <View>
      <Svg width={18} height={18} viewBox="0 0 24 24">
        {level === 'ok' ? <Path {...p} strokeWidth={2.4} d="m5 12 5 5 9-10" />
          : level === 'wait' ? <><Circle {...p} strokeWidth={2.2} cx={12} cy={12} r={9} /><Path {...p} strokeWidth={2.2} d="M12 7v5l3 2" /></>
            : <><Path {...p} strokeWidth={2.2} d="M2 2l20 20" /><Path {...p} strokeWidth={2.2} d="M8.5 16.5a5 5 0 0 1 7 0" /><Path {...p} strokeWidth={2.2} d="M5 13a10 10 0 0 1 5-2.8" /><Path {...p} strokeWidth={2.2} d="M19 13a10 10 0 0 0-2-1.6" /><Path {...p} strokeWidth={2.2} d="M12 20h.01" /></>}
      </Svg>
    </View>
  );
}
