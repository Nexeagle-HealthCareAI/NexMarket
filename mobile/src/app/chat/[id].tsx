import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MicButton } from '../../components/MicButton';
import { joinSpoken } from '../../lib/speech';
import { Alert, AppState, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Btn, Sheet, T, toast } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { PartnerPicker } from '../../components/PartnerPicker';
import { ChatAvatar, NX } from '../../components/ChatAvatar';
import { useSession } from '../../lib/session';
import { q } from '../../lib/db';
import {
  cachedLive, cachedMessages, cachedThreads, collapse, failedReason, flushChat, isOfficeUser, markRead, msTime, olderMessages, otherMarks, pendingCount, refreshMessages, retry, send,
  useChatVersion, type ChatMsg, type FailCode,
} from '../../lib/chat';
import { liveLine } from '../../lib/presence';
import { imageSource, MAX_FILE_BYTES, openChatFile, pickCamera, pickDocument, pickGallery, type Picked } from '../../lib/chatFiles';
import { quickPosition } from '../../lib/location';
import { callNumber, openDirections } from '../../lib/links';
import { OFFICE_PHONE } from '../../lib/config';
import { speak } from '../../lib/speak';
import { EMOJI } from '../../lib/emoji';
import { setOpenChat } from '../../lib/notifications';
import { dayLong, timeOf } from '../../lib/format';
import { C } from '../../theme';
import { CallButtons, CallPill, ChatCallBanner } from '../../components/CallParts';
import { useCallsStatus } from '../../lib/calls';
import { cachedTranslations, chatAiStatus, doneTask, looksDone, refreshChatAi, suggestReplies, translate } from '../../lib/chatAi';
import { cachedTasks, setTaskDone } from '../../lib/tasks';

// NexEagle look (not WhatsApp's): navy header, blue bubbles for me, white for others, mint read ticks.
const WA = { bg: '#eef1f6', mine: NX.mine, theirs: NX.theirs, head: NX.head, send: C.blue, meta: NX.meta, blueTick: NX.read, name: NX.name };
type Row = { kind: 'day'; key: string; at: string } | { kind: 'new'; key: string; n: number } | { kind: 'msg'; key: string; m: ChatMsg };
type TFn = ReturnType<typeof useSession>['t'];
type Lang = ReturnType<typeof useSession>['lang'];
const QUICK = ['chQuickDone', 'chQuickWay', 'chQuickCall', 'chQuickPhoto'] as const;
/** A "Where I am" message carries a Google Maps link; the bubble offers "Open map" for it. */
const MAP_RE = /https:\/\/maps\.google\.com\/\?q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;

export default function Conversation() {
  const { t, lang } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  useChatVersion();
  const thread = cachedThreads().find((x) => x.id === id);
  const msgs = cachedMessages(id);
  const marks = otherMarks(id);
  const live = cachedLive(id);
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [group, setGroup] = useState(0);
  const [tag, setTag] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [reply, setReply] = useState<ChatMsg | null>(null);
  const [viewer, setViewer] = useState<ChatMsg | null>(null);
  const [more, setMore] = useState(true);
  // "N new": how many were unread when the chat opened (it is marked read straight after), and when it opened.
  const [opened] = useState(() => ({ unread: thread?.unread ?? 0, at: Date.now() }));
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // While the keyboard is up it covers the gesture bar, so the composer drops its bottom inset.
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKb(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKb(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  const isTeam = thread?.kind === 'team';
  const isDirect = thread?.kind === 'direct';
  const visit = q.activeVisit();
  const callsOn = useCallsStatus().on;

  // ─── Smart chat: messages in my language, suggested replies, "is this task done?" ───
  const [ai, setAi] = useState(chatAiStatus);
  useEffect(() => { void refreshChatAi().then(setAi); }, []);
  const [, setTrVersion] = useState(0);
  const tr = ai.translate ? cachedTranslations(lang) : {};
  const lastKey = msgs.length ? `${msgs.length}:${msgs[msgs.length - 1].clientId}:${msgs[msgs.length - 1].state ?? ''}` : '';
  useEffect(() => {
    if (!ai.translate) return;
    const items = cachedMessages(id).filter((m) => !m.mine && !m.state && !m.call && m.text?.trim()).map((m) => ({ id: m.id, text: m.text! }));
    if (!items.length) return;
    let alive = true;
    void translate(id, items, lang).then((n) => { if (alive && n > 0) setTrVersion((v) => v + 1); }).catch(() => undefined);
    return () => { alive = false; };
  }, [ai.translate, id, lang, lastKey]);

  // Suggested replies for the latest message, when it is someone else's (an office user in an agent's chat answers as the office).
  const lastReal = [...msgs].reverse().find((m) => !m.call && !m.state) ?? null;
  const theirs = !!lastReal && !lastReal.mine && !(isOfficeUser() && thread?.kind === 'agent' && lastReal.fromOffice);
  const [sugg, setSugg] = useState<{ id: string; list: string[] } | null>(null);
  const suggAsked = useRef<string | null>(null);
  const lastRealId = lastReal?.id ?? null;
  useEffect(() => {
    if (!ai.replies || !theirs || !lastRealId || suggAsked.current === lastRealId) return;
    const timer = setTimeout(() => {
      suggAsked.current = lastRealId;
      void suggestReplies(id, lang).then((r) => setSugg({ id: r.forMessage ?? lastRealId, list: r.replies ?? [] })).catch(() => undefined);
    }, 700);
    return () => clearTimeout(timer);
  }, [ai.replies, theirs, lastRealId, id, lang]);
  const aiReplies = ai.replies && theirs && sugg && sugg.id === lastRealId ? sugg.list : [];

  // After I write "done" (or send a photo) in my office chat: once it reaches the office, ask whether it finishes a task.
  const doneWatch = useRef<string | null>(null);
  const [doneAsk, setDoneAsk] = useState<{ id: string; title: string; note: string | null } | null>(null);
  const watchDone = (clientId: string, body: string | null, photo: boolean) => {
    if (!ai.tasks || isOfficeUser() || (thread?.kind ?? 'agent') !== 'agent') return;
    // The server knows the open tasks (the phone may not have fetched a new one yet), and asks the AI only when there are some.
    if (!looksDone(body, photo)) return;
    doneWatch.current = clientId;
  };
  useEffect(() => {
    const cid = doneWatch.current;
    if (!cid) return;
    const m = cachedMessages(id).find((x) => x.clientId === cid);
    if (!m || m.state) return; // still on its way
    doneWatch.current = null;
    void doneTask(id, cid).then((task) => {
      // Not if it was already ticked off on this phone.
      if (task && !cachedTasks().some((x) => x.id === task.id && x.status !== 'open')) setDoneAsk({ ...task, note: m.text?.trim() || null });
    }).catch(() => undefined);
  }, [id, lastKey]);

  // While open and the app is in front: fetch new messages every few seconds, send what's waiting, and mark
  // read on opening, on coming back to the app, and when something new from others arrives. Paused in the background.
  useFocusEffect(useCallback(() => {
    let alive = true;
    let busy = false;
    let active = AppState.currentState === 'active';
    let needRead = true; // opening the chat reads it
    setOpenChat(id, active); // its messages don't pop up while it's on screen
    const tick = async () => {
      if (!alive || !active || busy) return;
      busy = true;
      try {
        if (pendingCount() > 0) void flushChat();
        const fresh = await refreshMessages(id);
        if (alive && active && (fresh || needRead)) { needRead = false; void markRead(id); }
      } catch { /* offline */ } finally { busy = false; }
    };
    void tick();
    const iv = setInterval(() => void tick(), 4000);
    const sub = AppState.addEventListener('change', (st) => {
      const now = st === 'active';
      if (now === active) return;
      active = now;
      setOpenChat(id, active);
      if (active) { needRead = true; void tick(); }
    });
    return () => { alive = false; clearInterval(iv); sub.remove(); setOpenChat(null); collapse(id); };
  }, [id]));

  const rows = useMemo<Row[]>(() => {
    // The first of the messages that were unread on opening (the newest N from others, not counting ones that came in since).
    let anchor: string | null = null;
    if (opened.unread > 0) {
      let n = 0;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.mine || msTime(m.createdAt) > opened.at + 60_000) continue;
        n++;
        anchor = m.clientId;
        if (n >= opened.unread) break;
      }
    }
    const out: Row[] = [];
    let last = '';
    for (const m of msgs) {
      const d = m.createdAt.slice(0, 10);
      const local = new Date(m.createdAt).toDateString();
      if (local !== last) { out.push({ kind: 'day', key: `d${d}${local}`, at: m.createdAt }); last = local; }
      if (m.clientId === anchor) out.push({ kind: 'new', key: 'new', n: opened.unread });
      out.push({ kind: 'msg', key: m.clientId, m });
    }
    return out.reverse(); // newest first for the inverted list
  }, [msgs, opened]);

  const clearNext = () => { setText(''); setTag(null); setReply(null); };
  const sendText = (body: string) => {
    const b = body.trim();
    if (!b) return;
    void send(id, { text: b, contact: tag, replyTo: reply }).then((cid) => watchDone(cid, b, false));
    clearNext();
  };
  const doSend = () => sendText(text);
  const sendFile = (f: Picked | 'denied' | 'unsupported' | null) => {
    if (f === 'denied') { Alert.alert(t('photo'), t('cameraDenied')); return; }
    if (f === 'unsupported') { Alert.alert(t('chatTitle'), t('chatBadType')); return; }
    if (!f) return;
    if (f.size != null && f.size > MAX_FILE_BYTES) { Alert.alert(t('chatTitle'), t('chatTooBig')); return; }
    const caption = text.trim() || undefined;
    void send(id, { text: caption, contact: tag, replyTo: reply, file: f }).then((cid) => watchDone(cid, caption ?? null, f.mime.startsWith('image/')));
    clearNext();
  };
  const attach = async (k: 'camera' | 'gallery' | 'doc') => {
    setAttachOpen(false);
    const f = k === 'camera' ? await pickCamera() : k === 'gallery' ? await pickGallery() : await pickDocument();
    sendFile(f);
  };
  /** "Where I am": a fresh fix sent as a normal message with a map link (it goes through the same send queue). */
  const shareHere = async () => {
    setAttachOpen(false);
    const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
    if (perm?.status !== 'granted') { Alert.alert(t('chWhereIAm'), t('chLocNone')); return; }
    toast(t('chLocFinding'));
    const p = await quickPosition();
    if (!p) { Alert.alert(t('chWhereIAm'), t('chLocNone')); return; }
    const link = `https://maps.google.com/?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
    const note = text.trim();
    void send(id, { text: `${note ? `${note}\n` : ''}📍 ${t('chHereMsg')}\n${link}`, contact: tag, replyTo: reply });
    clearNext();
  };
  const tagPartner = () => { setAttachOpen(false); setPicking(true); };
  const toggleEmoji = () => {
    if (emoji) { setEmoji(false); inputRef.current?.focus(); }
    else { Keyboard.dismiss(); setEmoji(true); }
  };
  const openFile = async (m: ChatMsg) => {
    if (!m.file) return;
    if (m.file.mime.startsWith('image/')) { setViewer(m); return; }
    try { await openChatFile(m); } catch { Alert.alert(t('chatTitle'), t('chatOpenFailed')); }
  };

  const title = isTeam ? t('chatTeam') : isDirect ? thread?.title ?? '' : isOfficeUser() ? thread?.title ?? t('chatOffice') : t('chatOffice');
  const now = liveLine(t, lang, live, thread?.kind ?? 'agent', isOfficeUser());
  const sub = now ?? (isTeam ? t('chatTeamSub') : isDirect ? thread?.sub ?? t('chatDirectSub') : t('chatOfficeSub'));
  const onlineNow = isTeam ? (live?.count ?? 0) > 0 : !!live?.online;
  const typing = !!text.trim();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: WA.head }} edges={['top', 'left', 'right']}>
      {/* Header, with a call button in the office chat. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12, backgroundColor: WA.head }}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/chat'))} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('back')}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="back" color="#fff" size={24} />
        </Pressable>
        {/* The office chat with calls on has three buttons on the right: its (always the same) avatar makes room for them. */}
        {callsOn && (thread?.kind ?? 'agent') === 'agent' && !isOfficeUser() && OFFICE_PHONE ? null : (
          <ChatAvatar kind={thread?.kind ?? 'agent'} name={title} photoUrl={thread?.photoUrl} size={44} online={!!live?.online && !isTeam} dark />
        )}
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <T style={{ color: '#fff', fontSize: 18, fontWeight: '800' }} numberOfLines={1}>{title}</T>
          <T style={{ color: onlineNow ? '#7ff5c2' : NX.headSub, fontSize: 14, fontWeight: onlineNow ? '600' : '400' }} numberOfLines={1}>{sub}</T>
        </View>
        {(thread?.kind ?? 'agent') === 'agent' && !isOfficeUser() && OFFICE_PHONE ? (
          <Pressable onPress={() => callNumber(OFFICE_PHONE)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('chCallOffice')}
            style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#3a4560', backgroundColor: '#1a2236', alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.8 }]}>
            <Icon name="phone" color="#fff" size={20} />
          </Pressable>
        ) : null}
        {/* App calls through the hospital's server: voice + video, or the Field team huddle. Hidden while calls are off. */}
        {thread ? <CallButtons threadId={id} kind={thread.kind} name={title} /> : null}
      </View>
      {/* A huddle or call going on in this chat: Join */}
      <ChatCallBanner threadId={id} />

      {/* Android draws edge-to-edge (the window no longer shrinks for the keyboard), so pad on both platforms. */}
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: WA.bg }} behavior="padding">
        <FlatList
          inverted
          data={rows}
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          windowSize={9}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 6 }}
          onEndReachedThreshold={0.3}
          onEndReached={() => { if (more) void olderMessages(id).then((m) => { if (m !== null) setMore(m); }).catch(() => undefined); }}
          ListFooterComponent={
            <View style={{ alignSelf: 'center', flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: C.blueSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, maxWidth: '92%' }}>
              <Icon name="lock" size={13} color={C.blueInk} />
              <T style={{ color: C.blueInk, fontSize: 13, textAlign: 'center', flexShrink: 1 }}>{isDirect ? t('chatDirectSecure', { name: title }) : t('chatSecureNote')}</T>
            </View>
          }
          renderItem={({ item }) => item.kind === 'day' ? (
            <View style={{ alignSelf: 'center', backgroundColor: '#d9dfe9', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginVertical: 8 }}>
              <T style={{ fontSize: 13, color: C.text3, fontWeight: '700' }}>{dayLabel(item.at, t, lang)}</T>
            </View>
          ) : item.kind === 'new' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 }} accessibilityRole="text">
              <View style={{ flex: 1, height: 2, backgroundColor: C.blue, opacity: 0.4 }} />
              <T style={{ fontSize: 13, fontWeight: '800', color: C.blueInk }}>{t('chNewCount', { n: item.n }).toUpperCase()}</T>
              <View style={{ flex: 1, height: 2, backgroundColor: C.blue, opacity: 0.4 }} />
            </View>
          ) : item.m.call ? (
            <CallPill note={item.m.call} mine={item.m.mine} threadId={id} canCall={!isTeam} />
          ) : (
            <Bubble m={item.m} showName={!item.m.mine && !isDirect && (isTeam || item.m.fromOffice)} readAt={marks.readAt} seenAt={marks.seenAt}
              lang={lang} t={t} translation={item.m.mine ? null : tr[item.m.id] ?? null} onReply={() => { setReply(item.m); inputRef.current?.focus(); }} onOpenFile={() => void openFile(item.m)}
              onOpenTag={(cid) => { if (q.contact(cid)) router.push({ pathname: '/partner/[id]', params: { id: cid } }); }} />
          )}
        />

        {/* What's attached to the next message */}
        {reply || tag ? (
          <View style={{ backgroundColor: '#fff', paddingHorizontal: 10, paddingTop: 8, gap: 6, borderTopWidth: 1, borderTopColor: C.border }}>
            {reply ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderLeftWidth: 4, borderLeftColor: C.blue, borderRadius: 10, paddingLeft: 10, gap: 8 }}>
                <View style={{ flex: 1, paddingVertical: 8 }}>
                  <T style={{ color: C.blueInk, fontWeight: '800', fontSize: 14 }}>{reply.mine ? t('chatYou') : reply.senderName}</T>
                  <T style={{ color: C.text2, fontSize: 15 }} numberOfLines={1}>{reply.text ?? (reply.file ? `📎 ${reply.file.name}` : '')}</T>
                </View>
                <Pressable onPress={() => setReply(null)} accessibilityRole="button" accessibilityLabel={t('chRemoveReply')}
                  style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={20} color={C.text2} /></Pressable>
              </View>
            ) : null}
            {tag ? (
              <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.purpleSoft, borderRadius: 999, paddingLeft: 12 }}>
                <Icon name="tag" size={16} color={C.purple} />
                <T style={{ color: C.purple, fontWeight: '700', fontSize: 15 }}>{tag.name}</T>
                <Pressable onPress={() => setTag(null)} accessibilityRole="button" accessibilityLabel={t('chRemoveTag')}
                  style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={18} color={C.purple} /></Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={{ backgroundColor: '#fff', borderTopWidth: reply || tag ? 0 : 1, borderTopColor: C.border, paddingHorizontal: 10, paddingTop: 10, gap: 10,
          paddingBottom: emoji || kb ? 10 : Math.max(insets.bottom, 10) }}>
          {/* One-tap replies: sent straight away, like typing them and pressing Send. Hidden while typing. */}
          {!typing && !emoji ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" accessibilityLabel={t('chQuickLabel')}
              contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
              {/* Suggested by smart chat: tapping puts it in the message box to change or send. */}
              {aiReplies.map((r) => (
                <Pressable key={`ai:${r}`} onPress={() => { setText(r); setSugg(null); inputRef.current?.focus(); }} accessibilityRole="button" accessibilityLabel={`${t('aiSuggested')}: ${r}`}
                  style={({ pressed }) => [{ minHeight: 44, maxWidth: 280, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: '#d9c8fd', backgroundColor: '#f6f1ff', flexDirection: 'row', alignItems: 'center', gap: 6 }, pressed && { opacity: 0.7 }]}>
                  <Icon name="sparkle" size={16} color="#6d28d9" />
                  <T style={{ color: '#4c1d95', fontSize: 15, fontWeight: '700', flexShrink: 1 }} numberOfLines={2}>{r}</T>
                </Pressable>
              ))}
              {QUICK.map((k) => (
                <Pressable key={k} onPress={() => sendText(t(k))} accessibilityRole="button" accessibilityLabel={`${t('chatSend')}: ${t(k)}`}
                  style={({ pressed }) => [{ minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: '#b9d7f5', backgroundColor: C.blueSoft, justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
                  <T style={{ color: C.blueInk, fontSize: 15, fontWeight: '700' }}>{t(k)}</T>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {/* Composer */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <Pressable onPress={() => setAttachOpen(true)} accessibilityRole="button" accessibilityLabel={t('chShare')}
              style={({ pressed }) => [{ width: 48, height: 52, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.6 }]}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="plus" size={24} color={tag ? C.purple : C.text3} strokeWidth={2.4} />
              </View>
            </Pressable>
            <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#fff', borderRadius: 26, borderWidth: 1, borderColor: C.borderStrong, paddingLeft: 2, paddingRight: 10, minHeight: 52 }}>
              <Pressable onPress={toggleEmoji} accessibilityRole="button" accessibilityLabel={t('chatEmoji')} hitSlop={4}
                style={({ pressed }) => [{ width: 44, height: 50, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.6 }]}>
                <Icon name={emoji ? 'note' : 'smile'} size={22} color={C.text2} />
              </Pressable>
              <TextInput ref={inputRef} value={text} onChangeText={setText} placeholder={t('chatType')} placeholderTextColor={C.muted} multiline maxLength={4000}
                accessibilityLabel={t('chatType')} onFocus={() => setEmoji(false)}
                style={{ flex: 1, fontSize: 17, color: C.text, paddingTop: 14, paddingBottom: 14, paddingHorizontal: 2, maxHeight: 140 }} />
            </View>
            {typing ? (
              <Pressable onPress={doSend} accessibilityRole="button" accessibilityLabel={t('chatSend')}
                style={({ pressed }) => [{ width: 52, height: 52, borderRadius: 26, backgroundColor: WA.send, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.85 }]}>
                <Icon name="send" color="#fff" size={24} />
              </Pressable>
            ) : (
              <>
                <Pressable onPress={() => void attach('camera')} accessibilityRole="button" accessibilityLabel={t('chTakePhoto')}
                  style={({ pressed }) => [{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
                  <Icon name="camera" color={C.blue} size={24} />
                </Pressable>
                <MicButton field="chat" size={52} onText={(spoken) => setText((cur) => joinSpoken(cur, spoken, 'chat'))} />
              </>
            )}
          </View>
        </View>

        {/* Built-in emoji, in place of the keyboard */}
        {emoji ? (
          <View style={{ height: 270 + insets.bottom, backgroundColor: '#fff', paddingBottom: insets.bottom }}>
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f0f2f5' }}>
              {EMOJI.map((g, i) => (
                <Pressable key={g.group} onPress={() => setGroup(i)} accessibilityRole="tab" accessibilityState={{ selected: i === group }} accessibilityLabel={g.group}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: i === group ? C.blue : 'transparent' }}>
                  <T style={{ fontSize: 22 }}>{g.icon}</T>
                </Pressable>
              ))}
            </View>
            <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', padding: 6 }} keyboardShouldPersistTaps="always">
              {EMOJI[group].list.map((e) => (
                <Pressable key={e} onPress={() => setText((x) => x + e)} accessibilityLabel={e} style={{ width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <T style={{ fontSize: 28 }}>{e}</T>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {/* Share sheet: big tiles */}
      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)} title={t('chShareWith', { name: title })}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <ShareTile icon="camera" bg={C.blueSoft} fg={C.blueInk} label={t('chatCamera')} onPress={() => void attach('camera')} />
          <ShareTile icon="image" bg={C.purpleSoft} fg={C.purple} label={t('chPhotos')} onPress={() => void attach('gallery')} />
          <ShareTile icon="pin" bg={C.okSoft} fg={C.okInk} label={t('chWhereIAm')} onPress={() => void shareHere()} />
          <ShareTile icon="user" bg={C.warnSoft} fg={C.warnInk} label={t('chAPartner')} onPress={tagPartner} active={!!tag} />
          <ShareTile icon="doc" bg={C.bg} fg={C.text3} label={t('chatDocument')} onPress={() => void attach('doc')} />
        </View>
        <T style={{ color: C.text2, fontSize: 14, textAlign: 'center' }}>{t('chatAttachHint')}</T>
      </Sheet>

      <Sheet visible={!!doneAsk} onClose={() => setDoneAsk(null)} title={t('aiDoneTitle')}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <Icon name="sparkle" size={22} color="#6d28d9" />
          <T style={{ flex: 1, fontSize: 17, lineHeight: 24, color: C.text }}>{doneAsk ? t('aiDoneBody', { task: doneAsk.title }) : ''}</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn label={t('aiNotYet')} kind="secondary" flex onPress={() => setDoneAsk(null)} />
          <Btn label={t('aiMarkDone')} icon="check" flex onPress={() => { if (doneAsk) { setTaskDone(doneAsk.id, doneAsk.note); toast(t('aiMarkedDone')); } setDoneAsk(null); }} />
        </View>
      </Sheet>

      <PartnerPicker visible={picking} onClose={() => setPicking(false)} onPick={(c) => setTag({ id: c.clientId, name: c.name })} panchayatFirst={visit?.panchayatId} />

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: insets.top + 8, paddingHorizontal: 12, paddingBottom: 8 }}>
            <Pressable onPress={() => setViewer(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('back')}><Icon name="back" color="#fff" size={24} /></Pressable>
            <T style={{ color: '#fff', flex: 1, fontWeight: '700' }} numberOfLines={1}>{viewer?.mine ? t('chatYou') : viewer?.senderName}</T>
            {viewer ? (
              <Pressable onPress={() => void openChatFile(viewer).catch(() => undefined)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('chOpenFile')}>
                <Icon name="download" color="#fff" size={24} />
              </Pressable>
            ) : null}
          </View>
          {viewer ? <Image source={imageSource(viewer)} style={{ flex: 1 }} resizeMode="contain" /> : null}
          {viewer?.text ? <T style={{ color: '#fff', padding: 16, paddingBottom: insets.bottom + 16 }}>{viewer.text}</T> : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function dayLabel(iso: string, t: TFn, lang: Lang) {
  const d = new Date(iso).toDateString();
  if (d === new Date().toDateString()) return t('today');
  if (d === new Date(Date.now() - 864e5).toDateString()) return t('yesterday');
  return dayLong(lang, new Date(iso));
}

function ShareTile({ icon, bg, fg, label, onPress, active }: { icon: IconName; bg: string; fg: string; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [{ width: '31.5%', flexGrow: 1, height: 108, borderRadius: 18, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 6,
        borderWidth: active ? 2 : 0, borderColor: fg }, pressed && { opacity: 0.75 }]}>
      <Icon name={icon} size={32} color={fg} />
      <T style={{ fontSize: 15, fontWeight: '800', color: fg, textAlign: 'center' }} numberOfLines={2}>{label}</T>
    </Pressable>
  );
}

/** What a message says, for reading aloud. */
function spoken(m: ChatMsg, t: TFn) {
  const body = (m.text ?? '').replace(MAP_RE, '').trim();
  return [m.senderName, body, m.file ? m.file.name : '', m.contact ? `${t('chAPartner')}: ${m.contact.name}` : ''].filter(Boolean).join('. ');
}

function Bubble({ m, showName, readAt, seenAt, lang, t, translation, onReply, onOpenFile, onOpenTag }: {
  m: ChatMsg; showName: boolean; readAt: string | null; seenAt: string | null;
  lang: Lang; t: TFn; translation?: string | null;
  onReply: () => void; onOpenFile: () => void; onOpenTag: (id: string) => void;
}) {
  const failed = m.state === 'failed';
  const pending = m.state === 'pending';
  const at = msTime(m.createdAt);
  const read = m.mine && !m.state && readAt != null && msTime(readAt) >= at;
  const seen = m.mine && !m.state && seenAt != null && msTime(seenAt) >= at;
  const isImage = !!m.file && m.file.mime.startsWith('image/');
  const map = m.text ? MAP_RE.exec(m.text) : null;
  const original = map ? m.text!.replace(MAP_RE, '').trim() : m.text;
  // Smart chat: shown in my language, with the original one tap away.
  const [showOriginal, setShowOriginal] = useState(false);
  const translated = translation ? translation.replace(MAP_RE, '').trim() : null;
  const shownText = translated && !showOriginal ? translated : original;
  const pad = isImage ? 8 : 0;
  const askRetry = () => Alert.alert(t('chatNotSent'), reasonText(failedReason(m.clientId), t), [{ text: t('cancel'), style: 'cancel' }, { text: t('chatRetry'), onPress: () => retry(m.clientId) }]);
  return (
    <Pressable onLongPress={m.state ? undefined : onReply} delayLongPress={300} onPress={failed ? askRetry : undefined}
      accessibilityHint={failed ? t('chNotSentTap') : undefined}
      style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '86%', marginVertical: 1, opacity: pending ? 0.85 : 1 }}>
      <View style={{ backgroundColor: m.mine ? WA.mine : WA.theirs, borderRadius: 18, borderBottomRightRadius: m.mine ? 6 : 18, borderBottomLeftRadius: m.mine ? 18 : 6,
        paddingHorizontal: isImage ? 4 : 14, paddingTop: isImage ? 4 : 10, paddingBottom: 8, gap: 6, borderWidth: failed ? 2 : m.mine ? 0 : 1, borderColor: failed ? C.bad : C.border,
        elevation: m.mine ? 2 : 0, shadowColor: C.blue, shadowOpacity: m.mine ? 0.18 : 0, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
        {!m.mine ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: pad, minHeight: 36 }}>
            <T style={{ flex: 1, color: WA.name, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>
              {showName ? `${m.senderName}${m.fromOffice ? ` · ${t('chatOfficeShort')}` : ''}` : ''}
            </T>
            <Pressable onPress={() => speak(spoken({ ...m, text: shownText }, t), lang)} accessibilityRole="button" accessibilityLabel={t('chReadAloud')} hitSlop={6}
              style={({ pressed }) => [{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
              <Icon name="volume" size={18} color={C.blue} />
            </Pressable>
          </View>
        ) : null}
        {m.replyTo ? (
          <View style={{ backgroundColor: m.mine ? 'rgba(255,255,255,0.16)' : C.blueSoft, borderLeftWidth: 3, borderLeftColor: m.mine ? NX.accent : C.blue, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
            <T style={{ color: m.mine ? NX.accent : C.blueInk, fontWeight: '800', fontSize: 13 }}>{m.replyTo.senderName}</T>
            <T style={{ color: m.mine ? NX.mineMeta : C.text2, fontSize: 15 }} numberOfLines={2}>{m.replyTo.text ?? (m.replyTo.fileName ? `📎 ${m.replyTo.fileName}` : '')}</T>
          </View>
        ) : null}
        {m.file ? (isImage ? (
          <Pressable onPress={onOpenFile} accessibilityRole="imagebutton" accessibilityLabel={m.file.name}>
            <Image source={imageSource(m)} style={{ width: 250, height: 250, borderRadius: 14, backgroundColor: C.line }} resizeMode="cover" />
          </Pressable>
        ) : (
          <Pressable onPress={onOpenFile} accessibilityRole="button" accessibilityLabel={m.file.name}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: m.mine ? 'rgba(255,255,255,0.14)' : C.bg, borderRadius: 12, padding: 10, minWidth: 220 }}>
            <View style={{ width: 40, height: 46, borderRadius: 8, backgroundColor: fileColor(m.file.name), alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{(m.file.name.split('.').pop() ?? '').toUpperCase().slice(0, 4)}</T>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T style={{ fontWeight: '700', fontSize: 15, color: m.mine ? '#fff' : C.text }} numberOfLines={2}>{m.file.name}</T>
              {m.file.size ? <T style={{ color: m.mine ? NX.mineMeta : WA.meta, fontSize: 13 }}>{fmtSize(m.file.size)}</T> : null}
            </View>
            <Icon name="download" size={20} color={m.mine ? '#fff' : WA.meta} />
          </Pressable>
        )) : null}
        {shownText ? <T style={{ fontSize: 17, lineHeight: 24, color: m.mine ? NX.mineText : NX.theirsText, paddingHorizontal: pad }}>{shownText}</T> : null}
        {translated ? (
          <Pressable onPress={() => setShowOriginal((o) => !o)} accessibilityRole="button" accessibilityLabel={showOriginal ? t('aiShowTranslation') : t('aiShowOriginal')} hitSlop={6}
            style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, paddingHorizontal: pad }}>
            <Icon name="sparkle" size={14} color="#6d28d9" />
            <T style={{ fontSize: 13, color: '#6d28d9', fontWeight: '700' }}>{showOriginal ? t('aiShowTranslation') : `${t('aiTranslated')} · ${t('aiShowOriginal')}`}</T>
          </Pressable>
        ) : null}
        {map ? (
          <Pressable onPress={() => openDirections(Number(map[1]), Number(map[2]))} accessibilityRole="button" accessibilityLabel={t('chOpenMap')}
            style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, marginHorizontal: pad,
              backgroundColor: m.mine ? 'rgba(255,255,255,0.2)' : C.okSoft }}>
            <Icon name="map" size={18} color={m.mine ? '#fff' : C.okInk} />
            <T style={{ color: m.mine ? '#fff' : C.okInk, fontWeight: '800', fontSize: 15 }}>{t('chOpenMap')}</T>
          </Pressable>
        ) : null}
        {m.contact ? (
          <Pressable onPress={() => onOpenTag(m.contact!.id)} accessibilityRole="button" accessibilityLabel={`${t('chAPartner')}: ${m.contact.name}`}
            style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: m.mine ? 'rgba(255,255,255,0.2)' : C.purpleSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginHorizontal: pad }}>
            <Icon name="tag" size={14} color={m.mine ? '#fff' : C.purple} />
            <T style={{ color: m.mine ? '#fff' : C.purple, fontWeight: '700', fontSize: 13 }}>{m.contact.name}</T>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 4, paddingHorizontal: pad }}>
          {m.mine && pending ? <Icon name="clock" size={14} color={NX.mineMeta} strokeWidth={2.2} /> : null}
          <T style={{ fontSize: 13, color: m.mine ? '#d6e9ff' : WA.meta }}>
            {pending ? t('chWaitingSignal') : `${timeOf(lang, m.createdAt)}${read ? ` · ${t('chRead')}` : ''}`}
          </T>
          {m.mine && !pending ? (failed ? <Icon name="alert" size={15} color="#ffd1cc" />
            : read ? <Icon name="checks" size={17} color={WA.blueTick} strokeWidth={2.4} />
              : seen ? <Icon name="checks" size={17} color={NX.mineMeta} /> : <Icon name="check" size={15} color={NX.mineMeta} />) : null}
        </View>
      </View>
      {failed ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 5, marginTop: 4, minHeight: 28 }}>
          <Icon name="refresh" size={15} color={C.bad} />
          <T style={{ color: C.bad, fontSize: 14, fontWeight: '700' }}>{t('chNotSentTap')}</T>
        </View>
      ) : null}
    </Pressable>
  );
}

const FAIL_KEYS: Record<FailCode, 'chatNotSent' | 'chatFailTimeout' | 'chatFailMissing'> = { notSent: 'chatNotSent', timeout: 'chatFailTimeout', missing: 'chatFailMissing' };
function reasonText(r: { code: FailCode | null; text: string | null }, t: TFn) {
  return r.code ? t(FAIL_KEYS[r.code]) : r.text ?? t('chatNotSent');
}

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function fileColor(name: string) {
  const e = name.split('.').pop()?.toLowerCase() ?? '';
  return e === 'pdf' ? '#e5484d' : ['doc', 'docx'].includes(e) ? '#2b6cd6' : ['xls', 'xlsx', 'csv'].includes(e) ? '#1f8a4c' : ['ppt', 'pptx'].includes(e) ? '#d9822b' : '#5a6478';
}
