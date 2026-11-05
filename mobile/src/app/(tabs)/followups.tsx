import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Btn, Card, Chip, Empty, Field, Screen, Sheet, T, TopBar, toast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { MoveSheet } from '../../components/MoveSheet';
import { WhatsAppSheet } from '../../components/WhatsAppSheet';
import { useDb, useSession } from '../../lib/session';
import { db, type Contact } from '../../lib/db';
import { setFollowUp } from '../../lib/repo';
import { callNumber, openDirections } from '../../lib/links';
import { dayShort, weekday } from '../../lib/format';
import { addDays, daysFromToday, ymd } from '../../lib/util';
import { C, PRIORITY_COLOR, type Priority } from '../../theme';
import type { Lang, TFn } from '../../i18n';

type Row = Contact & { place: string | null; pLat: number | null; pLng: number | null; refs: number };
type Mode = 'followUps' | 'all';
const PRIOS: Priority[] = ['very_high', 'high', 'normal', 'low'];
const RANK: Record<string, number> = { very_high: 0, high: 1, normal: 2, low: 3 };

export default function FollowUps() {
  const { t, lang } = useSession();
  const [mode, setMode] = useState<Mode>('followUps');
  const [day, setDay] = useState<string>('due'); // 'due' = overdue + today
  const [prio, setPrio] = useState<Priority | null>(null);
  const [term, setTerm] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [moving, setMoving] = useState<string | null>(null);
  const [wa, setWa] = useState<{ name: string; phone: string | null } | null>(null);

  const rows = useDb(() => db().getAllSync<Row>(
    `SELECT c.*, COALESCE(a.name, p.name) AS place, COALESCE(a.lat, p.lat) AS pLat, COALESCE(a.lng, p.lng) AS pLng,
            (SELECT COUNT(*) FROM referrals r WHERE r.contactId = c.clientId) AS refs
       FROM contacts c LEFT JOIN assigned a ON a.panchayatId = c.panchayatId LEFT JOIN panchayats p ON p.id = c.panchayatId`));

  const today = ymd();
  const strip = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(new Date(), i + 1)), []);
  const countFor = (key: string) => rows.filter((r) => r.followUpDate && (key === 'due' ? r.followUpDate <= today : r.followUpDate === key)).length;

  const list = useMemo(() => {
    let l = rows;
    if (mode === 'followUps') l = l.filter((r) => r.followUpDate && (day === 'due' ? r.followUpDate <= today : r.followUpDate === day));
    if (prio) l = l.filter((r) => r.priority === prio);
    if (f.types.length) l = l.filter((r) => f.types.includes(r.role));
    if (f.places.length) l = l.filter((r) => r.place != null && f.places.includes(r.place));
    if (f.whatsapp) l = l.filter((r) => !!r.whatsappAdded);
    if (f.card) l = l.filter((r) => !!r.cardGiven);
    if (f.sent) l = l.filter((r) => r.refs > 0);
    if (f.noFollowUp) l = l.filter((r) => !r.followUpDate);
    const s = term.trim().toLowerCase();
    const digits = s.replace(/\D/g, '');
    if (s) l = l.filter((r) => r.name.toLowerCase().includes(s) || (digits.length >= 3 && (r.phone ?? '').replace(/\D/g, '').includes(digits))
      || (r.place ?? '').toLowerCase().includes(s) || typeLabel(t, r.role).toLowerCase().includes(s));
    const byPriority = (a: Row, b: Row) => (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2) || (a.followUpDate ?? '9').localeCompare(b.followUpDate ?? '9') || a.name.localeCompare(b.name);
    const sorters: Record<Sort, (a: Row, b: Row) => number> = {
      priority: byPriority,
      name: (a, b) => a.name.localeCompare(b.name),
      newest: (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      patients: (a, b) => b.refs - a.refs || byPriority(a, b),
    };
    return [...l].sort(sorters[f.sort]);
  }, [rows, mode, day, prio, term, today, f, t]);
  const activeFilters = f.types.length + f.places.length + (f.whatsapp ? 1 : 0) + (f.card ? 1 : 0) + (f.sent ? 1 : 0) + (f.noFollowUp ? 1 : 0) + (f.sort !== 'priority' ? 1 : 0);

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Chip big label={t('followUps')} selected={mode === 'followUps'} onPress={() => setMode('followUps')} /></View>
        <View style={{ flex: 1 }}><Chip big label={t('allPartners')} selected={mode === 'all'} onPress={() => setMode('all')} /></View>
      </View>

      {mode === 'followUps' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <DayCell top={t('overdue')} bottom={t('today')} n={countFor('due')} on={day === 'due'} warn onPress={() => setDay('due')} />
          {strip.map((d) => {
            const k = ymd(d);
            return <DayCell key={k} top={weekday(lang, d)} bottom={String(d.getDate())} n={countFor(k)} on={day === k} onPress={() => setDay(k)} />;
          })}
        </ScrollView>
      ) : null}

      {/* Search and filters, in both views */}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Field placeholder={t('fltSearch')} value={term} onChangeText={setTerm} autoCorrect={false} returnKeyType="search" accessibilityLabel={t('searchPartners')} />
          {term ? (
            <Pressable onPress={() => setTerm('')} accessibilityRole="button" accessibilityLabel={t('fltClear')} hitSlop={6}
              style={{ position: 'absolute', right: 4, top: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={18} color={C.text2} />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={() => setFilterOpen(true)} accessibilityRole="button" accessibilityLabel={activeFilters ? `${t('fltFilter')}, ${activeFilters}` : t('fltFilter')}
          style={({ pressed }) => [{ height: 52, minWidth: 52, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            borderColor: activeFilters ? C.blue : C.borderStrong, backgroundColor: activeFilters ? C.blueSoft : C.card }, pressed && { opacity: 0.8 }]}>
          <Icon name="settings" size={20} color={activeFilters ? C.blueInk : C.text} />
          {activeFilters ? <T style={{ color: C.blueInk, fontWeight: '800' }}>{activeFilters}</T> : null}
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip label={t('all')} selected={!prio} onPress={() => setPrio(null)} />
        {PRIOS.map((p) => <Chip key={p} label={t(`priority_${p}`)} selected={prio === p} color={PRIORITY_COLOR[p].dot} onPress={() => setPrio(p)} />)}
      </ScrollView>
      {activeFilters || term ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T style={{ flex: 1, color: C.text2, fontSize: 13 }}>{t('fltShowing', { n: list.length, total: rows.length })}</T>
          <Pressable onPress={() => { setF(NO_FILTERS); setTerm(''); setPrio(null); }} hitSlop={8} accessibilityRole="button">
            <T style={{ color: C.blueInk, fontWeight: '700', fontSize: 13 }}>{t('fltClear')}</T>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false} padded={false} header={<TopBar title={mode === 'followUps' ? t('followUps') : t('myPartners', { n: rows.length })} onBack={false} />}>
      {/* A virtualised list: only the cards on screen are built, so hundreds of partners scroll smoothly. */}
      <FlatList
        data={list}
        keyExtractor={(c) => c.clientId}
        renderItem={({ item }) => <PartnerCard c={item} t={t} lang={lang} onWhatsApp={setWa} onMove={setMoving} />}
        ListHeaderComponent={header}
        ListEmptyComponent={<Empty text={t('noFollowUps')} icon="calendar" />}
        ItemSeparatorComponent={Gap}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
      />
      <WhatsAppSheet visible={!!wa} onClose={() => setWa(null)} name={wa?.name ?? ''} phone={wa?.phone ?? null} />
      <FilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} value={f} onChange={setF} rows={rows} t={t} />
      <MoveSheet visible={!!moving} onClose={() => setMoving(null)} onPick={(d) => { if (moving) setFollowUp(moving, d); setMoving(null); toast(t('savedOnPhone')); }} />
    </Screen>
  );
}

type Sort = 'priority' | 'name' | 'newest' | 'patients';
interface Filters { types: string[]; places: string[]; whatsapp: boolean; card: boolean; sent: boolean; noFollowUp: boolean; sort: Sort }
const NO_FILTERS: Filters = { types: [], places: [], whatsapp: false, card: false, sent: false, noFollowUp: false, sort: 'priority' };
const typeLabel = (t: TFn, role: string) => {
  const key = `type_${role}`;
  const v = t(key as never);
  return v && v !== key ? v : role.replace(/_/g, ' ');
};

/** Filter by type, panchayat and a few yes/no facts, and choose the order. Only what this agent's partners actually have is offered. */
function FilterSheet({ visible, onClose, value, onChange, rows, t }: {
  visible: boolean; onClose: () => void; value: Filters; onChange: (f: Filters) => void; rows: Row[]; t: TFn;
}) {
  const types = useMemo(() => [...new Set(rows.map((r) => r.role))].sort((a, b) => typeLabel(t, a).localeCompare(typeLabel(t, b))), [rows, t]);
  const places = useMemo(() => {
    const n = new Map<string, number>();
    rows.forEach((r) => { if (r.place) n.set(r.place, (n.get(r.place) ?? 0) + 1); });
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const sorts: { k: Sort; label: string }[] = [
    { k: 'priority', label: t('fltSortPriority') }, { k: 'name', label: t('fltSortName') }, { k: 'newest', label: t('fltSortNew') }, { k: 'patients', label: t('fltSortPatients') },
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title={t('fltFilter')}>
      <T style={{ fontWeight: '700' }}>{t('fltSort')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {sorts.map((x) => <Chip key={x.k} label={x.label} selected={value.sort === x.k} onPress={() => onChange({ ...value, sort: x.k })} />)}
      </View>

      <T style={{ fontWeight: '700' }}>{t('fltType')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {types.map((r) => <Chip key={r} label={typeLabel(t, r)} selected={value.types.includes(r)} onPress={() => onChange({ ...value, types: toggle(value.types, r) })} />)}
      </View>

      {places.length > 0 ? (
        <>
          <T style={{ fontWeight: '700' }}>{t('fltPlace')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {places.slice(0, 30).map(([p, n]) => <Chip key={p} label={`${p} · ${n}`} selected={value.places.includes(p)} onPress={() => onChange({ ...value, places: toggle(value.places, p) })} />)}
          </View>
        </>
      ) : null}

      <T style={{ fontWeight: '700' }}>{t('fltOnly')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Chip icon="whatsapp" label={t('fltWhatsApp')} selected={value.whatsapp} onPress={() => onChange({ ...value, whatsapp: !value.whatsapp })} />
        <Chip icon="doc" label={t('fltCard')} selected={value.card} onPress={() => onChange({ ...value, card: !value.card })} />
        <Chip icon="hospital" label={t('fltSent')} selected={value.sent} onPress={() => onChange({ ...value, sent: !value.sent })} />
        <Chip icon="calendar" label={t('fltNoFollowUp')} selected={value.noFollowUp} onPress={() => onChange({ ...value, noFollowUp: !value.noFollowUp })} />
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <Btn flex kind="secondary" label={t('fltClear')} onPress={() => onChange(NO_FILTERS)} />
        <Btn flex label={t('fltDone')} onPress={onClose} />
      </View>
    </Sheet>
  );
}

function Gap() {
  return <View style={{ height: 12 }} />;
}

const PartnerCard = React.memo(function PartnerCard({ c, t, lang, onWhatsApp, onMove }: {
  c: Row; t: TFn; lang: Lang; onWhatsApp: (x: { name: string; phone: string | null }) => void; onMove: (id: string) => void;
}) {
  const pc = PRIORITY_COLOR[c.priority] ?? PRIORITY_COLOR.normal;
  const fu = c.followUpDate ? daysFromToday(c.followUpDate) : null;
  const lat = c.lat ?? c.pLat;
  const lng = c.lng ?? c.pLng;
  return (
    <Card onPress={() => router.push({ pathname: '/partner/[id]', params: { id: c.clientId } })}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: pc.dot, marginTop: 6 }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {c.refs >= 5 || c.priority === 'very_high' ? <Icon name="star" size={15} color={C.star} /> : null}
            <T style={{ fontSize: 16, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{c.name}</T>
          </View>
          <T style={{ color: C.text2, fontSize: 13 }} numberOfLines={1}>{[t(`type_${c.role}` as never), c.place].filter(Boolean).join(' · ')}</T>
          {fu != null ? (
            <T style={{ fontSize: 13, fontWeight: '600', color: fu < 0 ? C.warnInk : C.blueInk }}>
              {fu < 0 ? t('followUpOverdue', { n: -fu }) : t('followUpOn', { date: fu === 0 ? t('today') : fu === 1 ? t('tomorrow') : dayShort(lang, c.followUpDate!) })}
            </T>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <T style={{ color: pc.fg, fontSize: 12, fontWeight: '700' }}>{t(`priority_${c.priority}`)}</T>
          {c.phone ? (
            <Pressable onPress={() => onWhatsApp({ name: c.name, phone: c.phone })} accessibilityRole="button" accessibilityLabel={t('whatsapp')} hitSlop={8}
              style={({ pressed }) => [{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#e7f8ee', alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
              <Icon name="whatsapp" size={20} color="#1fa855" />
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn flex small kind="secondary" icon="phone" label={t('call')} disabled={!c.phone} onPress={() => callNumber(c.phone)} />
        <Btn flex small kind="secondary" icon="nav" label={t('goMeet')} disabled={lat == null || lng == null} onPress={() => lat != null && lng != null && openDirections(lat, lng)} />
        <Btn flex small kind="ghost" icon="calendar" label={t('moveFollowUp')} onPress={() => onMove(c.clientId)} />
      </View>
    </Card>
  );
});

function DayCell({ top, bottom, n, on, warn, onPress }: { top: string; bottom: string; n: number; on: boolean; warn?: boolean; onPress: () => void }) {
  const bg = on ? (warn ? C.warn : C.blue) : C.card;
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}
      style={{ minWidth: 60, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, alignItems: 'center', gap: 2, backgroundColor: bg, borderWidth: 1, borderColor: on ? bg : C.border }}>
      <T style={{ fontSize: 12, color: on ? '#fff' : C.text2 }}>{top}</T>
      <T style={{ fontSize: 16, fontWeight: '800', color: on ? '#fff' : C.text }}>{bottom}</T>
      <View style={{ minWidth: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: on ? 'rgba(255,255,255,0.25)' : n ? (warn ? C.warnSoft : C.blueSoft) : C.line }}>
        <T style={{ fontSize: 11, fontWeight: '700', textAlign: 'center', color: on ? '#fff' : warn ? C.warnInk : C.blueInk }}>{n}</T>
      </View>
    </Pressable>
  );
}
