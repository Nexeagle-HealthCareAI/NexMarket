import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Btn, Card, Empty, Field, Pill, Screen, Sheet, T, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDb, useSession } from '../lib/session';
import { lastVisited, q, timesVisited } from '../lib/db';
import { PanchayatList, sortPanchayats } from '../components/PanchayatList';
import { NoteList } from '../components/NoteList';
import { EscalateSheet } from '../components/EscalateSheet';
import { EscalationStatus } from '../components/EscalationStatus';
import { tryCheckIn } from '../lib/visit';
import { relDay } from '../lib/format';
import { addNote, addPhoto, checkOut, setFollowUp } from '../lib/repo';
import { currentPosition, quickPosition } from '../lib/location';
import { takePhoto } from '../lib/photo';
import { useHere } from '../lib/useHere';
import { CHECK_IN_RADIUS_M } from '../lib/config';
import { formatDist } from '../lib/plan';
import { timeOf } from '../lib/format';
import { addDays, haversineM, ymd } from '../lib/util';
import { C } from '../theme';

type Met = 'met' | 'notMet';
type Interest = 'interestHigh' | 'interestSome' | 'interestNone';

export default function CheckIn() {
  const { t, lang } = useSession();
  const params = useLocalSearchParams<{ panchayatId?: string; contactId?: string }>();
  const [panchayatId, setPanchayatId] = useState(params.panchayatId || '');
  const here = useHere(true);
  const [busy, setBusy] = useState(false);

  const info = useDb(() => {
    const a = panchayatId ? q.assignedOne(panchayatId) : null;
    const p = panchayatId ? q.panchayat(panchayatId) : null;
    return {
      name: a?.name ?? p?.name ?? '',
      lat: a?.lat ?? p?.lat ?? null,
      lng: a?.lng ?? p?.lng ?? null,
      approx: (a?.source ?? 'block') === 'block' && a != null,
      times: a ? timesVisited(a) : 0,
      last: a ? lastVisited(a) : null,
      shift: q.activeShift(),
      visit: q.activeVisit(),
      partners: panchayatId ? q.contactsIn(panchayatId) : [],
      assigned: q.assigned(),
    };
  }, [panchayatId]);

  // No panchayat chosen yet: pick one (nearest first).
  if (!panchayatId) {
    const list = sortPanchayats(info.assigned, here);
    const done = list.filter((p) => timesVisited(p) > 0).length;
    return (
      <Screen header={<TopBar title={t('choosePanchayat')} sub={list.length ? t('blockProgress', { done, total: list.length }) : undefined} />}>
        {list.length === 0 ? <Empty text={t('noBlock')} icon="map" /> : <T style={{ color: C.text2, fontSize: 13 }}>{t('revisitHint')}</T>}
        <PanchayatList list={list} here={here} current={info.visit?.panchayatId ?? null} onPick={setPanchayatId} />
      </Screen>
    );
  }

  const inThis = info.visit && info.visit.panchayatId === panchayatId ? info.visit : null;
  if (inThis) return <InVisit visit={inThis} name={info.name} partners={info.partners} initialContact={params.contactId || null} />;

  const dist = here && info.lat != null && info.lng != null ? haversineM(here, { lat: info.lat, lng: info.lng }) : null;
  const canCheckIn = !!info.shift && (info.approx || info.lat == null || (dist != null && dist <= CHECK_IN_RADIUS_M));

  const doCheckIn = async () => {
    setBusy(true);
    try {
      // Leaves the panchayat they were in (if any) and checks in here, first visit or revisit.
      const r = await tryCheckIn(panchayatId);
      if (!r.ok && r.why === 'no-fix') Alert.alert(t('locationOff'), t('turnOnLocation'));
      else if (!r.ok && r.why === 'far') confirmFar(r.distM);
      else toast(t('savedOnPhone'));
    } finally {
      setBusy(false);
    }
  };

  // Too far from the panchayat centre (or its pin is wrong): the agent can still check in; the
  // location saved with it shows the office where they really were.
  const confirmFar = (distM: number) => Alert.alert(t('checkIn'), t('farCheckInConfirm', { name: info.name, dist: formatDist(distM, t) }), [
    { text: t('close'), style: 'cancel' },
    { text: t('checkInAnyway'), onPress: () => void anyway() },
  ]);
  const anyway = async () => {
    setBusy(true);
    try {
      const r = await tryCheckIn(panchayatId, { anyDistance: true });
      if (!r.ok) Alert.alert(t('locationOff'), t('turnOnLocation'));
      else toast(t('savedOnPhone'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<TopBar title={info.name || t('checkIn')} sub={t('checkIn')} />}>
      <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="pin" size={30} color={C.blue} />
        </View>
        <T style={{ fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{info.name}</T>
        {dist != null ? <T style={{ color: C.text2 }}>{formatDist(dist, t)}</T> : null}
        {info.times ? <Pill label={t('visitedTimes', { n: info.times, when: info.last ? relDay(t, lang, info.last) : '—' })} tone="ok" icon="check" /> : <Pill label={t('notVisitedYet')} tone="blue" />}
        {info.approx ? <T style={{ color: C.text2, textAlign: 'center', fontSize: 13 }}>{t('approxPin')}</T> : null}
        {!info.shift ? (
          <>
            <T style={{ color: C.warnInk, textAlign: 'center' }}>{t('startShiftToCheckIn')}</T>
            <Btn label={t('startShift')} kind="ok" icon="nav" onPress={() => router.push('/shift')} style={{ alignSelf: 'stretch' }} />
          </>
        ) : !canCheckIn && dist != null ? (
          <T style={{ color: C.warnInk, textAlign: 'center' }}>{t('tooFar', { name: info.name, dist: formatDist(dist, t) })}</T>
        ) : null}
        {info.shift ? <Btn label={info.times ? t('revisitCheckIn') : t('checkIn')} icon="pin" onPress={doCheckIn} loading={busy} style={{ alignSelf: 'stretch' }} /> : null}
        {info.shift && !canCheckIn && dist != null ? <Btn kind="ghost" label={t('checkInAnyway')} onPress={() => confirmFar(dist)} style={{ alignSelf: 'stretch' }} /> : null}
        {info.visit && info.visit.panchayatId !== panchayatId ? <T style={{ color: C.text2, textAlign: 'center', fontSize: 13 }}>{t('willLeaveCurrent')}</T> : null}
      </Card>
      {info.partners.length ? (
        <>
          <T style={{ fontWeight: '700', marginTop: 8 }}>{t('myPartners', { n: info.partners.length })}</T>
          {info.partners.map((c) => (
            <Card key={c.clientId} onPress={() => router.push({ pathname: '/partner/[id]', params: { id: c.clientId } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <T style={{ flex: 1, fontWeight: '600' }}>{c.name}</T>
              <T style={{ color: C.text2, fontSize: 13 }}>{t(`type_${c.role}` as never)}</T>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

type Outcome = 'good' | 'maybe' | 'no' | 'notMet';
const OUTCOMES: { key: Outcome; met: Met; interest: Interest | null; icon: 'check' | 'star' | 'close' | 'clock'; color: string; soft: string }[] = [
  { key: 'good', met: 'met', interest: 'interestHigh', icon: 'star', color: C.ok, soft: C.okSoft },
  { key: 'maybe', met: 'met', interest: 'interestSome', icon: 'check', color: C.blue, soft: C.blueSoft },
  { key: 'no', met: 'met', interest: 'interestNone', icon: 'close', color: C.warn, soft: C.warnSoft },
  { key: 'notMet', met: 'notMet', interest: null, icon: 'clock', color: C.muted, soft: C.line },
];
const PHRASES = ['qpWillRefer', 'qpOpdTimings', 'qpCallBack', 'qpWantsCamp', 'qpBusy', 'qpPayment'] as const;
const FOLLOW = [{ k: 'tomorrow', d: 1 }, { k: 'in3Days', d: 3 }, { k: 'in1Week', d: 7 }, { k: 'noFollowUpNeeded', d: null }] as const;

/**
 * One screen for the whole panchayat: find someone or add someone from the same box, and record a
 * revisit right in the list (outcome, an optional comment, when to go back), with no extra screens.
 */
function InVisit({ visit, name, partners, initialContact }: {
  visit: NonNullable<ReturnType<typeof q.activeVisit>>; name: string; partners: ReturnType<typeof q.contactsIn>; initialContact: string | null;
}) {
  const { t, lang } = useSession();
  const here = useHere(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(initialContact || null);
  const [switching, setSwitching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doneNow, setDoneNow] = useState<Set<string>>(new Set());
  // Someone just added here (back from Add partner): open them so their first meeting is one tap away.
  const known = useRef(new Set(partners.map((c) => c.clientId)));
  useEffect(() => {
    const fresh = partners.find((c) => !known.current.has(c.clientId));
    partners.forEach((c) => known.current.add(c.clientId));
    if (fresh) { setOpen(fresh.clientId); setSearch(''); }
  }, [partners]);

  const stats = useDb(() => new Map(q.visitStatsIn(visit.panchayatId).map((r) => [r.contactId, r])), [visit.panchayatId, partners.length, doneNow.size]);
  const assigned = useDb(() => q.assigned());
  const today = ymd(new Date());

  // Due follow-ups first, then those not met for longest, then the rest by name.
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const d = s.replace(/\D/g, '');
    const list = s ? partners.filter((c) => c.name.toLowerCase().includes(s) || (d.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(d))) : partners;
    const due = (c: (typeof partners)[number]) => !!c.followUpDate && c.followUpDate.slice(0, 10) <= today;
    const last = (id: string) => stats.get(id)?.last ?? '';
    return [...list].sort((a, b) => Number(due(b)) - Number(due(a)) || last(a.clientId).localeCompare(last(b.clientId)) || a.name.localeCompare(b.name));
  }, [partners, search, stats, today]);
  const dueCount = partners.filter((c) => c.followUpDate && c.followUpDate.slice(0, 10) <= today && !doneNow.has(c.clientId)).length;

  const out = async () => {
    setBusy(true);
    const pos = await currentPosition();
    checkOut(visit.clientId, pos?.lat ?? null, pos?.lng ?? null);
    setBusy(false);
    toast(t('savedOnPhone'));
    router.replace('/today');
  };
  const moveTo = async (pid: string) => {
    setSwitching(false);
    if (pid === visit.panchayatId) return;
    const r = await tryCheckIn(pid, { anyDistance: true });
    if (!r.ok) Alert.alert(t('locationOff'), t('turnOnLocation'));
    else { toast(t('nowIn', { name: q.assignedOne(pid)?.name ?? '' })); router.replace({ pathname: '/checkin', params: { panchayatId: pid } }); }
  };
  const addNew = () => router.push({ pathname: '/partner-new', params: { panchayatId: visit.panchayatId, name: search.trim() } });
  const typed = search.trim();
  const looksLikeName = typed.length >= 2 && !/^\d+$/.test(typed);

  return (
    <Screen header={<TopBar title={name} sub={t('qCheckedIn', { time: timeOf(lang, visit.checkInAt) })} dark
      right={<Pressable onPress={() => setSwitching(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('changePanchayat')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.12)' }}>
        <Icon name="pin" size={14} color={C.mint} />
        <T style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{t('change')}</T>
      </Pressable>} />}
      footer={<View style={{ flexDirection: 'row', gap: 8, padding: 12, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
        <Btn flex kind="secondary" icon="check" label={t('checkOut')} onPress={out} loading={busy} />
        <Btn flex kind="ghost" icon="pin" label={t('nextPanchayat')} onPress={() => setSwitching(true)} />
      </View>}>

      {/* One box: search someone already here, or type a new name to add them. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 16, borderWidth: 1.5, borderColor: search ? C.blue : C.borderStrong, paddingHorizontal: 14, minHeight: 54 }}>
        <Icon name="search" color={C.text2} />
        <TextInput value={search} onChangeText={setSearch} placeholder={t('qSearchOrAdd')} placeholderTextColor={C.muted}
          style={{ flex: 1, fontSize: 16, color: C.text, paddingVertical: 12 }} autoCorrect={false} returnKeyType="search" />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={10}><Icon name="close" color={C.text2} size={18} /></Pressable> : null}
      </View>

      <Pressable onPress={addNew} accessibilityRole="button" style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: C.blue,
      }, pressed && { opacity: 0.88 }]}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" color="#fff" size={24} />
        </View>
        <View style={{ flex: 1 }}>
          <T style={{ color: '#fff', fontSize: 17, fontWeight: '800' }} numberOfLines={1}>{looksLikeName ? t('qAddNamed', { name: typed }) : t('addPartner')}</T>
          <T style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>{t('qAddSub')}</T>
        </View>
        <Icon name="chevron" color="#fff" />
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <T style={{ flex: 1, fontSize: 17, fontWeight: '800' }}>{search ? t('qMatches', { n: rows.length }) : t('qPeopleHere', { n: partners.length })}</T>
        {dueCount && !search ? <Pill label={t('qDueN', { n: dueCount })} tone="warn" icon="calendar" /> : null}
      </View>
      {partners.length === 0 ? <T style={{ color: C.text2 }}>{t('noOneHereYet')}</T> : null}
      {partners.length > 0 && rows.length === 0 ? <T style={{ color: C.text2 }}>{t('qNoMatch')}</T> : null}

      {rows.map((c) => (
        <PersonRow key={c.clientId} c={c} stat={stats.get(c.clientId)} visitAt={visit.checkInAt} open={open === c.clientId} done={doneNow.has(c.clientId)}
          onToggle={() => setOpen(open === c.clientId ? null : c.clientId)}
          onSaved={() => { setDoneNow((x) => new Set(x).add(c.clientId)); setOpen(null); setSearch(''); }} today={today} />
      ))}

      <Sheet visible={switching} onClose={() => setSwitching(false)} title={t('choosePanchayat')}>
        <T style={{ color: C.text2, fontSize: 13 }}>{t('qSwitchHint')}</T>
        <PanchayatList list={sortPanchayats(assigned, here)} here={here} current={visit.panchayatId} onPick={(pid) => void moveTo(pid)} />
      </Sheet>
    </Screen>
  );
}

/** A person in the list; tapping opens the quick revisit right here. */
function PersonRow({ c, stat, visitAt, open, done, onToggle, onSaved, today }: {
  c: ReturnType<typeof q.contactsIn>[number]; stat?: { n: number; last: string | null }; visitAt: string; open: boolean; done: boolean;
  onToggle: () => void; onSaved: () => void; today: string;
}) {
  const { t, lang } = useSession();
  const isNew = c.createdAt >= visitAt;
  const due = !!c.followUpDate && c.followUpDate.slice(0, 10) <= today && !done;
  const lastNote = useDb(() => q.lastNote(c.clientId), [c.clientId, done]);
  const sub = done ? t('qDoneNow')
    : isNew ? t('qAddedNow')
      : stat?.n ? t('partnerVisits', { n: stat.n, when: stat.last ? relDay(t, lang, stat.last) : '–' }) : t('noVisitNoteYet');
  return (
    <View style={{ borderRadius: 16, borderWidth: open ? 2 : 1, borderColor: open ? C.blue : due ? '#f5d9a8' : C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }, pressed && { backgroundColor: C.line }]}>
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: done ? C.okSoft : due ? C.warnSoft : C.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
          {done ? <Icon name="check" color={C.okInk} /> : <T style={{ color: due ? C.warnInk : C.blueInk, fontWeight: '800', fontSize: 16 }}>{c.name.trim().charAt(0).toUpperCase()}</T>}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T style={{ fontWeight: '800', fontSize: 16 }} numberOfLines={1}>{c.name}</T>
          <T style={{ color: done ? C.okInk : due ? C.warnInk : C.text2, fontSize: 13 }} numberOfLines={1}>
            {t(`type_${c.role}` as never)} · {due ? t('qDueToday') : sub}
          </T>
          {!open && lastNote && !done ? <T style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>“{lastNote.text.replace(/\n/g, ' ')}”</T> : null}
        </View>
        {!open ? (
          <View style={{ paddingHorizontal: 12, height: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: done ? C.okSoft : C.blueSoft }}>
            <T style={{ color: done ? C.okInk : C.blueInk, fontWeight: '800', fontSize: 13 }}>{done ? t('qAgain') : isNew ? t('qFirstMeet') : t('revisitBtn')}</T>
          </View>
        ) : <Icon name="close" color={C.text2} size={18} />}
      </Pressable>
      {open ? <QuickVisit c={c} isNew={isNew} onSaved={onSaved} /> : null}
    </View>
  );
}

/**
 * Record a meeting in three taps: how it went (one tap: met + interest together), when to go back
 * (a week is already picked), Save. A comment is optional; quick phrases fill it in one tap.
 */
function QuickVisit({ c, isNew, onSaved }: { c: ReturnType<typeof q.contactsIn>[number]; isNew: boolean; onSaved: () => void }) {
  const { t } = useSession();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [comment, setComment] = useState('');
  const [follow, setFollow] = useState<number | null>(7);
  const [saving, setSaving] = useState(false);
  const [escOpen, setEscOpen] = useState(false);
  const history = useDb(() => q.notesFor(c.clientId), [c.clientId]);

  const addPhrase = (k: (typeof PHRASES)[number]) => {
    const p = t(k);
    setComment((x) => (x.includes(p) ? x : x.trim() ? `${x.trim()}. ${p}` : p));
  };
  const save = async () => {
    const o = OUTCOMES.find((x) => x.key === outcome);
    if (!o || saving) return;
    setSaving(true);
    const pos = await quickPosition();
    const text = [t('visitNoteText', { met: t(o.met), interest: o.interest ? t(o.interest) : '–' }), comment.trim()].filter(Boolean).join('\n');
    addNote(c.clientId, text, isNew ? 'visit' : 'revisit', pos);
    setFollowUp(c.clientId, follow == null ? null : ymd(addDays(new Date(), follow)));
    setSaving(false);
    toast(pos ? t('revisitSaved') : t('revisitSavedNoGps'));
    onSaved();
  };
  const photo = async () => {
    const p = await takePhoto();
    if (p === 'denied') { Alert.alert(t('photo'), t('cameraDenied')); return; }
    if (p) { addPhoto(c.clientId, p); toast(t('savedOnPhone')); }
  };

  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12 }}>
      <EscalationStatus c={c} />
      {history.length ? <NoteList notes={history} limit={1} title={t('qLastTime')} /> : null}

      <T style={{ fontWeight: '800' }}>{isNew ? t('howWasIt') : t('howWasRevisit')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {OUTCOMES.map((o) => {
          const on = outcome === o.key;
          return (
            <Pressable key={o.key} onPress={() => setOutcome(o.key)} accessibilityRole="radio" accessibilityState={{ selected: on }}
              style={{ width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingHorizontal: 12, borderRadius: 14,
                borderWidth: on ? 2 : 1, borderColor: on ? o.color : C.borderStrong, backgroundColor: on ? o.soft : C.card }}>
              <Icon name={o.icon} size={18} color={on ? o.color : C.text2} />
              <T style={{ flex: 1, fontWeight: on ? '800' : '600', color: on ? C.text : C.text3, fontSize: 14 }} numberOfLines={2}>{t(`qo_${o.key}` as never)}</T>
            </Pressable>
          );
        })}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
        {PHRASES.map((k) => (
          <Pressable key={k} onPress={() => addPhrase(k)} style={({ pressed }) => [{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border }, pressed && { opacity: 0.7 }]}>
            <T style={{ fontSize: 13, color: C.text3 }}>+ {t(k)}</T>
          </Pressable>
        ))}
      </ScrollView>
      <Field placeholder={t('qCommentOptional')} value={comment} onChangeText={setComment} multiline maxLength={2000} />

      <T style={{ color: C.text2, fontWeight: '700', fontSize: 13 }}>{t('nextFollowUp')}</T>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {FOLLOW.map((f) => {
          const on = follow === f.d;
          return (
            <Pressable key={f.k} onPress={() => setFollow(f.d)} accessibilityRole="radio" accessibilityState={{ selected: on }}
              style={{ flex: 1, minHeight: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
                backgroundColor: on ? C.ink : C.bg, borderWidth: 1, borderColor: on ? C.ink : C.border }}>
              <T style={{ fontSize: 12.5, fontWeight: '700', color: on ? '#fff' : C.text3, textAlign: 'center' }} numberOfLines={2}>{t(f.k)}</T>
            </Pressable>
          );
        })}
      </View>

      <Btn kind="ok" icon="check" label={outcome ? t('qSave') : t('qPickOutcome')} onPress={() => void save()} loading={saving} disabled={!outcome} />

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Action icon="hospital" label={t('referPatient')} onPress={() => router.push({ pathname: '/refer', params: { contactId: c.clientId } })} />
        <Action icon="camera" label={t('photoOptional')} onPress={() => void photo()} />
        <Action icon="flag" label={t('escalate')} onPress={() => setEscOpen(true)} danger />
        <Action icon="note" label={t('qMore')} onPress={() => router.push({ pathname: '/partner/[id]', params: { id: c.clientId } })} />
      </View>
      <EscalateSheet visible={escOpen} onClose={() => setEscOpen(false)} contactId={c.clientId} name={c.name} />
    </View>
  );
}

function Action({ icon, label, onPress, disabled, danger }: { icon: 'hospital' | 'note' | 'camera' | 'flag'; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [{
      flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    }, disabled && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
      <Icon name={icon} color={danger ? C.bad : C.blue} />
      <T style={{ fontSize: 13, fontWeight: '600', textAlign: 'center', color: danger ? C.bad : C.text }}>{label}</T>
    </Pressable>
  );
}
