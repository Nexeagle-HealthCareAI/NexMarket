import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Btn, Pill, T, liveText, toast, useTextScale } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ComplaintSheet } from '../../components/ComplaintSheet';
import { VitalsSheet } from '../../components/VitalsSheet';
import { campPlace, campWhen } from '../../components/CampPicker';
import { useDb, useSession } from '../../lib/session';
import { campDay, campList, campVitals, markPerson, refreshCampDay, searchPeople, vitalBits, type CampPerson, type CampStatus } from '../../lib/camps';
import { dayShort, timeOf } from '../../lib/format';
import { savedFeedback } from '../../lib/prefs';
import { C } from '../../theme';
import type { Lang, TFn } from '../../i18n';

type Filter = 'all' | CampStatus;

/**
 * The camp day. Everyone booked for the camp (by agents, on WhatsApp, at the desk), searchable by name, mobile,
 * panchayat or token, with one tap for Arrived or Didn't come. Any agent can mark; the CRM sees the same list. A mark
 * made by mistake is undone by tapping the person. Works with no signal: the list is on the phone, marks go later.
 * Complaint and vitals can be added for anyone (optional).
 */
export default function CampDayScreen() {
  const { t, lang } = useSession();
  const scale = useTextScale();
  const focused = useIsFocused();
  const { id } = useLocalSearchParams<{ id: string }>();
  const day = useDb(() => campDay(id), [id]);
  const fromList = useDb(() => campList()?.camps.find((c) => c.id === id) ?? null, [id]);
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<Filter>('booked');
  const [place, setPlace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [gone, setGone] = useState(false);
  const [person, setPerson] = useState<{ p: CampPerson; what: 'complaint' | 'vitals' } | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try { await refreshCampDay(id); setOffline(false); setGone(false); } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404) setGone(true); else setOffline(true);
    } finally { setBusy(false); }
  }, [id]);
  useEffect(() => { void reload(); }, [reload]);
  // Others mark people too (another agent, the desk in the CRM): keep the list fresh while it is open.
  useEffect(() => {
    if (!focused) return undefined;
    const tm = setInterval(() => { void refreshCampDay(id).then(() => setOffline(false)).catch(() => setOffline(true)); }, 30000);
    return () => clearInterval(tm);
  }, [focused, id]);

  const items = day?.items ?? [];
  const found = useMemo(() => {
    let l = searchPeople(items, text);
    if (place) l = l.filter((p) => (p.village ?? '').trim().toLowerCase() === place.toLowerCase());
    return l;
  }, [items, text, place]);
  // While searching, show everyone who matches (marked or not); otherwise the chosen tab.
  const list = text.trim() ? found : filter === 'all' ? found : found.filter((p) => p.status === filter);
  // The three numbers count the whole camp (or the chosen panchayat), not just what the search box matches.
  const counted = place ? items.filter((p) => (p.village ?? '').trim().toLowerCase() === place.toLowerCase()) : items;
  const counts = { booked: counted.filter((p) => p.status === 'booked').length, attended: counted.filter((p) => p.status === 'attended').length, no_show: counted.filter((p) => p.status === 'no_show').length };
  const camp = day?.camp ?? (fromList ? { ...fromList, place: campPlace(fromList), isToday: fromList.date === campList()?.today } : null);
  const isToday = !!day?.camp.isToday || (!!fromList && fromList.date === campList()?.today);

  const mark = (p: CampPerson, status: CampStatus) => {
    void markPerson(id, p.id, { status });
    savedFeedback();
    const back = () => void markPerson(id, p.id, { status: p.status });
    if (status === 'attended') toast(t('cmMarkedArrived', { name: p.name }), { undo: back });
    else if (status === 'no_show') toast(t('cmMarkedNoShow', { name: p.name }), { undo: back });
    else toast(t('cmUndone'));
  };
  const askUndo = (p: CampPerson) => Alert.alert(t('cmUndoAsk', { name: p.name }), '', [{ text: t('cancel'), style: 'cancel' }, { text: t('cmUndo'), onPress: () => mark(p, 'booked') }]);
  const walkIn = () => router.push({ pathname: '/appointment', params: { camp: id, walkIn: '1', ...(text.trim() && !/^\d+$/.test(text.trim()) ? { name: text.trim() } : {}) } });

  const tabs: { key: CampStatus; label: string; n: number; color: string }[] = [
    { key: 'booked', label: t('cmWaiting'), n: counts.booked, color: '#fff' },
    { key: 'attended', label: t('cmArrived'), n: counts.attended, color: '#6ee7b7' },
    { key: 'no_show', label: t('cmNoShow'), n: counts.no_show, color: '#fcd34d' },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }} edges={['top']}>
      <View style={{ backgroundColor: C.ink, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/camps'))} accessibilityRole="button" accessibilityLabel={t('back')} hitSlop={8}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -10 }}>
            <Icon name="back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T style={{ fontSize: 12.5, color: '#a6f7d2', fontWeight: '800' }}>{isToday ? `${t('cmCampDay').toUpperCase()} · ${t('apToday').toUpperCase()}` : camp ? campWhen(camp, t, lang) : ''}</T>
            <T style={{ fontSize: 19, fontWeight: '800', color: '#fff' }} numberOfLines={1}>{camp?.title ?? t('cmCampDay')}</T>
          </View>
        </View>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 6 }}>
          {tabs.map((x) => {
            const on = !text.trim() && filter === x.key;
            return (
              <Pressable key={x.key} onPress={() => { setText(''); setFilter(on ? 'all' : x.key); }} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${x.label}, ${x.n}`}
                style={({ pressed }) => [{ flex: 1, minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? '#fff' : C.ink2,
                  borderWidth: 1, borderColor: on ? '#fff' : C.inkLine }, pressed && { opacity: 0.85 }]}>
                <T style={{ fontSize: 18, fontWeight: '800', color: on ? C.ink : x.color }}>{x.n}</T>
                <T style={{ fontSize: 12, fontWeight: '700', color: on ? C.ink : '#c3cbdc' }} numberOfLines={1}>{x.label}</T>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, minHeight: 50 }}>
          <Icon name="search" size={20} color={C.text3} />
          <TextInput value={text} onChangeText={setText} placeholder={t('cmSearch')} placeholderTextColor={C.muted} accessibilityLabel={t('cmSearch')} autoCorrect={false}
            style={liveText({ flex: 1, minWidth: 0, fontSize: 16.5, color: C.text, paddingVertical: 10 }, scale)} />
          {text ? <Pressable onPress={() => setText('')} accessibilityRole="button" accessibilityLabel={t('cancel')} hitSlop={8}><Icon name="close" size={18} color={C.text3} /></Pressable> : null}
        </View>
        {(day?.places.length ?? 0) > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {[{ name: null as string | null, label: t('cmAllPlaces') }, ...(day?.places ?? []).map((p) => ({ name: p.name as string | null, label: `${p.name} · ${p.n}` }))].map((x) => {
              const on = place === x.name;
              return (
                <Pressable key={x.name ?? '*'} onPress={() => setPlace(x.name)} accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={{ paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: on ? '#fff' : 'transparent', borderWidth: 1, borderColor: on ? '#fff' : '#3a4763' }}>
                  <T style={{ fontSize: 13.5, fontWeight: '700', color: on ? C.ink : '#fff' }}>{x.label}</T>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void reload()} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 28 }}
          ListHeaderComponent={
            <View style={{ gap: 8 }}>
              {gone ? <T style={{ color: C.bad, fontSize: 14 }}>{t('cmCampGone')}</T> : null}
              {offline && day ? (
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Icon name="cloudOff" size={14} color={C.warnInk} />
                  <T style={{ flex: 1, color: C.warnInk, fontSize: 13.5 }}>{t('cmOldList', { time: timeOf(lang, day.at) })}</T>
                </View>
              ) : null}
              {!isToday && camp ? <T style={{ color: C.text2, fontSize: 14 }}>{t('cmNotYet', { d: dayShort(lang, camp.date) })}</T> : null}
            </View>
          }
          renderItem={({ item }) => (
            <PersonCard p={item} t={t} lang={lang} canMark={isToday} onMark={mark} onUndo={askUndo} onDetails={(what) => setPerson({ p: item, what })} />
          )}
          ListEmptyComponent={
            text.trim() ? (
              <Pressable onPress={walkIn} accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.muted, backgroundColor: C.card }}>
                <Icon name="plus" size={22} color={C.blue} />
                <T style={{ flex: 1, fontSize: 15 }}>{t('cmNotBooked', { q: text.trim() })}</T>
              </Pressable>
            ) : <T style={{ color: C.text2, fontSize: 15, textAlign: 'center', paddingVertical: 20 }}>{items.length ? t('cmNoMatch') : t('cmNobody')}</T>
          }
          ListFooterComponent={
            <View style={{ gap: 10, marginTop: 6 }}>
              {isToday && (list.length > 0 || !text.trim()) ? <Btn kind="secondary" icon="plus" label={t('cmAddWalkIn')} onPress={walkIn} /> : null}
              <T style={{ fontSize: 13, color: C.text3, textAlign: 'center', paddingHorizontal: 8 }}>{t('cmSameList')}</T>
            </View>
          }
          initialNumToRender={12}
          windowSize={9}
          keyboardShouldPersistTaps="handled"
        />
      </View>

      <ComplaintSheet visible={person?.what === 'complaint'} onClose={() => setPerson(null)} value={person?.p.complaint ?? null}
        onSave={(c) => { if (person) void markPerson(id, person.p.id, { complaint: c }); setPerson(null); savedFeedback(); toast(t('cmDetailsSaved')); }} />
      <VitalsSheet short visible={person?.what === 'vitals'} onClose={() => setPerson(null)} title={person ? `${t('apVitalsTitle')} · ${person.p.name}` : undefined}
        onSave={(v) => { if (person) void markPerson(id, person.p.id, campVitals(v)); setPerson(null); savedFeedback(); toast(t('apVitalsSaved')); }} />
    </SafeAreaView>
  );
}

const PersonCard = React.memo(function PersonCard({ p, t, lang, canMark, onMark, onUndo, onDetails }: {
  p: CampPerson; t: TFn; lang: Lang; canMark: boolean; onMark: (p: CampPerson, s: CampStatus) => void; onUndo: (p: CampPerson) => void; onDetails: (what: 'complaint' | 'vitals') => void;
}) {
  const sex = p.sex === 'F' ? t('apFemale') : p.sex === 'M' ? t('apMale') : p.sex === 'O' ? t('apOther') : null;
  const who = p.statusBy === 'me' ? t('cmYou') : p.statusBy ?? (p.statusVia === 'crm' ? t('cmViaCrm') : null);
  const marked = p.status !== 'booked';
  const bg = p.status === 'attended' ? C.okSoft : p.status === 'no_show' ? C.warnSoft : C.card;
  const info = [p.age != null ? `${p.age}` : null, sex, p.village, p.phone].filter(Boolean).join(' · ');
  const markLine = p.status === 'attended'
    ? [p.arrivedAt ? t('cmArrivedAt', { time: timeOf(lang, p.arrivedAt) }) : t('cmArrived'), who ? t('cmBy', { who }) : null].filter(Boolean).join(' · ')
    : p.status === 'no_show' ? [t('cmNoShow'), who ? t('cmBy', { who }) : null].filter(Boolean).join(' · ') : null;
  const bits = p.vitals ? vitalBits(p.vitals) : [];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 18, borderWidth: 1, borderColor: p.status === 'attended' ? '#b7e3cc' : C.border, padding: 12, gap: 10 }}>
      <Pressable onPress={marked && canMark ? () => onUndo(p) : undefined} disabled={!marked || !canMark} accessibilityRole={marked && canMark ? 'button' : undefined}
        accessibilityLabel={`${t('cmToken')} ${p.token}, ${p.name}. ${markLine ?? ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: marked ? '#fff' : C.purpleSoft, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ fontSize: 17, fontWeight: '800', color: C.purple }}>{p.token}</T>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <T style={{ fontSize: 16.5, fontWeight: '800' }} numberOfLines={1}>{p.name}</T>
          {info ? <T style={{ fontSize: 13.5, color: C.text2 }} numberOfLines={1}>{info}</T> : null}
          {markLine ? <T style={{ fontSize: 13.5, fontWeight: '700', color: p.status === 'attended' ? C.okInk : C.warnInk }} numberOfLines={1}>{markLine}</T>
            : p.bookedBy ? <T style={{ fontSize: 12.5, color: C.text3 }} numberOfLines={1}>{p.byMe ? t('cmBookedBy', { who: t('cmYou') }) : t('cmBookedBy', { who: p.bookedBy })}</T> : null}
        </View>
        {p.unsent ? <Icon name="cloudOff" size={15} color={C.warnInk} /> : null}
        {marked && canMark ? <T style={{ fontSize: 13, fontWeight: '700', color: C.blue }}>{t('cmUndo')}</T> : null}
      </Pressable>

      {p.complaint || bits.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {p.complaint ? <T style={{ fontSize: 14, flexShrink: 1 }} numberOfLines={1}>{p.complaint}</T> : null}
          {bits.map((b) => <Pill key={b} label={b} />)}
        </View>
      ) : null}

      {!marked && canMark ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => onMark(p, 'attended')} accessibilityRole="button" accessibilityLabel={`${t('cmArrived')}: ${p.name}`}
            style={({ pressed }) => [{ flex: 2, minHeight: 52, borderRadius: 14, backgroundColor: C.ok, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.85 }]}>
            <Icon name="check" size={20} color="#fff" strokeWidth={3} />
            <T style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{t('cmArrived')}</T>
          </Pressable>
          <Pressable onPress={() => onMark(p, 'no_show')} accessibilityRole="button" accessibilityLabel={`${t('cmNoShow')}: ${p.name}`}
            style={({ pressed }) => [{ flex: 1, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, pressed && { opacity: 0.85 }]}>
            <T style={{ color: C.text2, fontSize: 14.5, fontWeight: '700', textAlign: 'center' }} numberOfLines={2}>{t('cmNoShow')}</T>
          </Pressable>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 18 }}>
        <Pressable onPress={() => onDetails('complaint')} accessibilityRole="button" hitSlop={6} style={{ minHeight: 36, justifyContent: 'center' }}>
          <T style={{ color: C.blue, fontWeight: '700', fontSize: 14 }}>{p.complaint ? `${t('apComplaint')} · ${t('apEdit')}` : `+ ${t('apComplaint')}`}</T>
        </Pressable>
        <Pressable onPress={() => onDetails('vitals')} accessibilityRole="button" hitSlop={6} style={{ minHeight: 36, justifyContent: 'center' }}>
          <T style={{ color: C.blue, fontWeight: '700', fontSize: 14 }}>+ {t('apAddVitals')}</T>
        </Pressable>
      </View>
    </View>
  );
});
