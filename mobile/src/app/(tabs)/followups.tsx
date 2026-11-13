import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar, Btn, Card, Chip, Empty, Field, MainHeader, Screen, Sheet, T, toast } from '../../components/ui';
import { ActionTile } from '../../components/ActionTile';
import { savedFeedback } from '../../lib/prefs';
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
  // Late + today, the next three days, then everything after as "Later".
  const strip = useMemo(() => Array.from({ length: 3 }, (_, i) => addDays(new Date(), i + 1)), []);
  const lastStrip = ymd(strip[strip.length - 1]);
  const onDay = (date: string | null, key: string) => !!date && (key === 'due' ? date <= today : key === 'later' ? date > lastStrip : date === key);
  const countFor = (key: string) => rows.filter((r) => onDay(r.followUpDate, key)).length;
  const dueCount = countFor('due');

  const list = useMemo(() => {
    let l = rows;
    if (mode === 'followUps') l = l.filter((r) => onDay(r.followUpDate, day));
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
    }, [rows, mode, day, prio, term, today, lastStrip, f, t]);
  const activeFilters = f.types.length + f.places.length + (f.whatsapp ? 1 : 0) + (f.card ? 1 : 0) + (f.sent ? 1 : 0) + (f.noFollowUp ? 1 : 0) + (f.sort !== 'priority' ? 1 : 0);

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      {mode === 'followUps' ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <DayCell top={t('ptLateToday')} n={dueCount} on={day === 'due'} warn onPress={() => setDay('due')} />
          {strip.map((d) => {
            const k = ymd(d);
            return <DayCell key={k} top={`${weekday(lang, d)} ${d.getDate()}`} n={countFor(k)} on={day === k} onPress={() => setDay(k)} />;
          })}
          <DayCell top={t('ptLater')} n={countFor('later')} on={day === 'later'} onPress={() => setDay('later')} />
        </View>
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
    <Screen scroll={false} padded={false} bg={C.ink} header={(
      <MainHeader title={t('ptPartners')}>
        {/* To follow up, or everyone: the switch sits in the header so it stays put while the list scrolls. */}
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, backgroundColor: C.ink2, padding: 4, borderRadius: 14 }}>
          <Segment label={dueCount ? t('ptFollowUpsN', { n: dueCount }) : t('followUps')} on={mode === 'followUps'} onPress={() => setMode('followUps')} />
          <Segment label={`${t('allPartners')} · ${rows.length}`} on={mode === 'all'} onPress={() => setMode('all')} />
        </View>
      </MainHeader>
    )}>
      {/* A virtualised list: only the cards on screen are built, so hundreds of partners scroll smoothly. */}
      <FlatList
        style={{ backgroundColor: C.bg }}
        data={list}
        keyExtractor={(c) => c.clientId}
        renderItem={({ item }) => <PartnerCard c={item} t={t} lang={lang} onWhatsApp={setWa} onMove={setMoving} />}
        ListHeaderComponent={header}
        ListEmptyComponent={<Empty text={t('noFollowUps')} icon="calendar" />}
        ListFooterComponent={mode === 'followUps' && list.length > 0 ? <EndLine text={day === 'due'
          ? (countFor(ymd(strip[0])) ? t('ptEndToday', { n: countFor(ymd(strip[0])) }) : t('ptEndTodayNone'))
          : t('ptEndDay')} /> : undefined}
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
      <MoveSheet visible={!!moving} onClose={() => setMoving(null)} onPick={(d) => {
        if (moving) {
          const id = moving;
          const before = rows.find((r) => r.clientId === id)?.followUpDate ?? null;
          setFollowUp(id, d);
          savedFeedback();
          toast(t('ptMovedTo', { date: dayShort(lang, d) }), { undo: () => setFollowUp(id, before) });
        }
        setMoving(null);
      }} />
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

/** Avatar and pill colours by priority (very important is purple, so it never looks like "overdue" red). */
const PRIO_TONE: Record<string, { bg: string; fg: string }> = {
  very_high: { bg: C.purpleSoft, fg: C.purple },
  high: { bg: C.warnSoft, fg: C.warnInk },
  normal: { bg: C.blueSoft, fg: C.blueInk },
  low: { bg: C.line, fg: C.text2 },
};

function SmallPill({ label, bg, fg, big }: { label: string; bg: string; fg: string; big?: boolean }) {
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: bg }}>
      <T style={{ color: fg, fontSize: big ? 14 : 13, fontWeight: '700' }}>{label}</T>
    </View>
  );
}

const PartnerCard = React.memo(function PartnerCard({ c, t, lang, onWhatsApp, onMove }: {
  c: Row; t: TFn; lang: Lang; onWhatsApp: (x: { name: string; phone: string | null }) => void; onMove: (id: string) => void;
}) {
  const tone = PRIO_TONE[c.priority] ?? PRIO_TONE.normal;
  const fu = c.followUpDate ? daysFromToday(c.followUpDate) : null;
  const lat = c.lat ?? c.pLat;
  const lng = c.lng ?? c.pLng;
  const status = fu == null ? null
    : fu < 0 ? { label: t('ptOverdueBy', { n: -fu }), bg: C.badSoft, fg: C.bad }
      : fu === 0 ? { label: t('ptDueToday'), bg: C.warnSoft, fg: C.warnInk }
        : fu === 1 ? { label: t('ptDueTomorrow'), bg: C.blueSoft, fg: C.blueInk }
          : { label: t('ptDueOn', { date: dayShort(lang, c.followUpDate!) }), bg: C.blueSoft, fg: C.blueInk };
  return (
    <Card onPress={() => router.push({ pathname: '/partner/[id]', params: { id: c.clientId } })} style={{ gap: 12, borderRadius: 18 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <Avatar name={c.name} size={48} bg={tone.bg} color={tone.fg} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {c.refs >= 5 || c.priority === 'very_high' ? <Icon name="star" size={15} color={C.star} /> : null}
            <T style={{ fontSize: 18, fontWeight: '800', flexShrink: 1 }} numberOfLines={2}>{c.name}</T>
          </View>
          <T style={{ color: C.text2, fontSize: 15 }} numberOfLines={2}>{[typeLabel(t, c.role), c.place].filter(Boolean).join(' · ')}</T>
          {status ? <View style={{ marginTop: 4 }}><SmallPill big label={status.label} bg={status.bg} fg={status.fg} /></View> : null}
        </View>
        <SmallPill label={t(`priority_${c.priority}` as never)} bg={tone.bg} fg={tone.fg} />
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <ActionTile grow={1.3} tone="primary" icon="phone" label={t('call')} a11y={t('ptA11yCall', { name: c.name })} disabled={!c.phone} onPress={() => callNumber(c.phone)} />
        <ActionTile oneLine tone="wa" icon="whatsapp" label={t('whatsapp')} a11y={t('ptA11yWa', { name: c.name })} disabled={!c.phone} onPress={() => onWhatsApp({ name: c.name, phone: c.phone })} />
        <ActionTile oneLine icon="nav" label={t('ptRoute')} a11y={t('ptA11yRoute', { name: c.name })} disabled={lat == null || lng == null} onPress={() => lat != null && lng != null && openDirections(lat, lng)} />
        <ActionTile oneLine icon="calendar" label={t('ptLater')} a11y={t('ptA11yLater', { name: c.name })} onPress={() => onMove(c.clientId)} />
      </View>
    </Card>
  );
});

function Segment({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}
      style={({ pressed }) => [{ flex: 1, minHeight: 48, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
        backgroundColor: on ? '#fff' : 'transparent' }, pressed && { opacity: 0.85 }]}>
      <T style={{ fontSize: 16, fontWeight: on ? '800' : '700', color: on ? C.ink : '#c3cbdc', textAlign: 'center' }} numberOfLines={2}>{label}</T>
    </Pressable>
  );
}

function DayCell({ top, n, on, warn, onPress }: { top: string; n: number; on: boolean; warn?: boolean; onPress: () => void }) {
  const bg = on ? (warn ? C.warn : C.blue) : C.card;
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${top}, ${n}`}
      style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 64, paddingHorizontal: 2, paddingVertical: 6, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2,
        backgroundColor: bg, borderWidth: 1, borderColor: on ? bg : C.border }, pressed && { opacity: 0.85 }]}>
      <T style={{ fontSize: 12, fontWeight: '700', color: on ? '#fff' : C.text2, textAlign: 'center' }} numberOfLines={2}>{top}</T>
      <T style={{ fontSize: on ? 20 : 18, fontWeight: '800', color: on ? '#fff' : n ? C.text : C.muted }}>{n}</T>
    </Pressable>
  );
}

function EndLine({ text }: { text: string }) {
  return (
    <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: C.blueSoft }}>
      <Icon name="check" size={20} color={C.blueInk} />
      <T style={{ flex: 1, color: C.blueInk, fontSize: 15, fontWeight: '600' }}>{text}</T>
    </View>
  );
}
