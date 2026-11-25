import React, { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Sheet, T, liveText, useTextScale } from './ui';
import { Icon } from './Icon';
import { useDb, useSession } from '../lib/session';
import { db, kvJson, kvSet, q, type Panchayat } from '../lib/db';
import { formatDist } from '../lib/plan';
import { haversineM } from '../lib/util';
import type { Here } from '../lib/useHere';
import { C } from '../theme';

const K_RECENT = 'appt.recentPlaces';

/** Panchayats used last for a booking, newest first (ids). */
export const recentPanchayats = (): string[] => kvJson<string[]>(K_RECENT, []);
export function rememberPanchayat(id: string) {
  kvSet(K_RECENT, JSON.stringify([id, ...recentPanchayats().filter((x) => x !== id)].slice(0, 6)));
}

interface Row { id: string; name: string; block: string; district: string; dist: number | null }

/**
 * Choosing where a patient lives. Nothing to scroll through blindly: where I am now and the ones I used lately come
 * first, then my own block (nearest first); typing searches every panchayat the hospital knows, in any block, by
 * panchayat or block name. "Not in the list" lets the agent write the place themselves.
 */
export function PanchayatPicker({ visible, onClose, onPick, onWrite, selected, here }: {
  visible: boolean; onClose: () => void; onPick: (p: Panchayat) => void; onWrite: () => void; selected: string | null; here: Here | null;
}) {
  const { t } = useSession();
  const scale = useTextScale();
  const [text, setText] = useState('');
  const visit = useDb(() => q.activeVisit());
  const assigned = useDb(() => q.assigned());
  const mineIds = useMemo(() => new Set(assigned.map((a) => a.panchayatId)), [assigned]);
  const dist = (p: { lat: number | null; lng: number | null }) => (here && p.lat != null && p.lng != null ? haversineM(here, { lat: p.lat, lng: p.lng }) : null);
  const row = (p: Panchayat | null): Row | null => (p ? { id: p.id, name: p.name, block: p.block, district: p.district, dist: dist(p) } : null);

  const term = text.trim().toLowerCase();
  const found = useDb(() => {
    if (term.length < 2) return [] as Panchayat[];
    return db().getAllSync<Panchayat>(
      `SELECT * FROM panchayats WHERE lower(name) LIKE ? OR lower(block) LIKE ? ORDER BY CASE WHEN lower(name) LIKE ? THEN 0 ELSE 1 END, name LIMIT 60`,
      `%${term}%`, `%${term}%`, `${term}%`);
  }, [term]);

  const sections = useMemo(() => {
    if (term.length >= 2) {
      // My block first, then the rest; a panchayat's own name before a block-name match.
      const rows = found.map(row).filter((x): x is Row => !!x).sort((a, b) => Number(mineIds.has(b.id)) - Number(mineIds.has(a.id)));
      return [{ title: '', rows }];
    }
    const out: { title: string; rows: Row[] }[] = [];
    const seen = new Set<string>();
    const add = (title: string, rows: (Row | null)[]) => {
      const r = rows.filter((x): x is Row => !!x && !seen.has(x.id));
      r.forEach((x) => seen.add(x.id));
      if (r.length) out.push({ title, rows: r });
    };
    add(t('apHereNow'), [visit ? row(q.panchayat(visit.panchayatId)) : null]);
    add(t('apRecent'), recentPanchayats().map((id) => row(q.panchayat(id))));
    add(t('apYourBlock'), assigned.map((a) => row(q.panchayat(a.panchayatId) ?? { id: a.panchayatId, name: a.name, block: '', district: '', lat: a.lat, lng: a.lng }))
      .filter((x): x is Row => !!x).sort((a, b) => (a.dist ?? 1e12) - (b.dist ?? 1e12) || a.name.localeCompare(b.name)));
    return out;
  }, [term, found, visit, assigned, mineIds, here]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id: string) => { const p = q.panchayat(id); if (p) { setText(''); onPick(p); } };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('apPickPanchayat')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 14, paddingHorizontal: 12, backgroundColor: C.card }}>
        <Icon name="search" size={20} color={C.text3} />
        <TextInput value={text} onChangeText={setText} placeholder={t('apSearchPanchayat')} placeholderTextColor={C.muted} accessibilityLabel={t('apSearchPanchayat')}
          autoCorrect={false} style={liveText({ flex: 1, minWidth: 0, fontSize: 17, color: C.text, paddingVertical: 10 }, scale)} />
        {text ? (
          <Pressable onPress={() => setText('')} accessibilityRole="button" accessibilityLabel={t('cancel')} hitSlop={8}><Icon name="close" size={18} color={C.text3} /></Pressable>
        ) : null}
      </View>

      {term.length >= 2 && found.length === 0 ? <T style={{ color: C.text2, fontSize: 15 }}>{t('apNoMatch')}</T> : null}

      {sections.map((s) => (
        <View key={s.title || 'found'} style={{ gap: 8 }}>
          {s.title ? <T style={{ fontSize: 12.5, fontWeight: '800', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4 }}>{s.title}</T> : null}
          {s.rows.map((r) => {
            const on = r.id === selected;
            return (
              <Pressable key={r.id} onPress={() => pick(r.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
                  borderWidth: on ? 2 : 1, borderColor: on ? C.blue : C.border, backgroundColor: on ? C.blueSoft : C.card }, pressed && { opacity: 0.85 }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T style={{ fontSize: 16.5, fontWeight: '800' }} numberOfLines={1}>{r.name}</T>
                  <T style={{ fontSize: 13.5, color: C.text2 }} numberOfLines={1}>{[r.block && `${t('apBlock')}: ${r.block}`, r.district].filter(Boolean).join(' · ')}</T>
                </View>
                {r.dist != null ? <T style={{ fontSize: 13, color: C.text3 }}>{formatDist(r.dist, t)}</T> : null}
                {on ? <Icon name="check" size={20} color={C.blue} /> : null}
              </Pressable>
            );
          })}
        </View>
      ))}

      {term.length < 2 ? <T style={{ color: C.text2, fontSize: 14 }}>{t('apOtherBlocksHint')}</T> : null}
      <Pressable onPress={() => { setText(''); onWrite(); }} accessibilityRole="button" style={{ minHeight: 48, justifyContent: 'center' }}>
        <T style={{ color: C.blue, fontWeight: '700', fontSize: 15.5 }}>{t('apNotInList')}</T>
      </Pressable>
    </Sheet>
  );
}
