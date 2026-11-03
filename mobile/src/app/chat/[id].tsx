import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sheet, T } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { PartnerPicker } from '../../components/PartnerPicker';
import { ChatAvatar, NX } from '../../components/ChatAvatar';
import { useSession } from '../../lib/session';
import { q } from '../../lib/db';
import {
  cachedMessages, cachedThreads, failedReason, isOfficeUser, markRead, olderMessages, otherMarks, refreshMessages, retry, send, useChatVersion, type ChatMsg,
} from '../../lib/chat';
import { imageSource, MAX_FILE_BYTES, openChatFile, pickCamera, pickDocument, pickGallery, type Picked } from '../../lib/chatFiles';
import { EMOJI } from '../../lib/emoji';
import { setOpenChat } from '../../lib/notifications';
import { dayLong, timeOf } from '../../lib/format';
import { C } from '../../theme';

// NexEagle look (not WhatsApp's): navy header with a mint line, blue bubbles for me, mint read ticks.
const WA = { bg: NX.bg, mine: NX.mine, theirs: NX.theirs, head: NX.head, send: C.blue, meta: NX.meta, blueTick: NX.read, name: NX.name };
type Row = { kind: 'day'; key: string; at: string } | { kind: 'msg'; key: string; m: ChatMsg };

export default function Conversation() {
  const { t, lang } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  useChatVersion();
  const thread = cachedThreads().find((x) => x.id === id);
  const msgs = cachedMessages(id);
  const marks = otherMarks(id);
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [group, setGroup] = useState(0);
  const [tag, setTag] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [reply, setReply] = useState<ChatMsg | null>(null);
  const [viewer, setViewer] = useState<ChatMsg | null>(null);
  const [more, setMore] = useState(true);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const isTeam = thread?.kind === 'team';
  const isDirect = thread?.kind === 'direct';
  const visit = q.activeVisit();

  // While open: fetch new messages every few seconds and mark them read.
  useFocusEffect(useCallback(() => {
    let alive = true;
    setOpenChat(id); // its messages don't pop up while it's open
    const tick = async () => {
      try { await refreshMessages(id); if (alive) void markRead(id); } catch { /* offline */ }
    };
    void tick();
    const iv = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(iv); setOpenChat(null); };
  }, [id]));

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let last = '';
    for (const m of msgs) {
      const d = m.createdAt.slice(0, 10);
      const local = new Date(m.createdAt).toDateString();
      if (local !== last) { out.push({ kind: 'day', key: `d${d}${local}`, at: m.createdAt }); last = local; }
      out.push({ kind: 'msg', key: m.clientId, m });
    }
    return out.reverse(); // newest first for the inverted list
  }, [msgs]);

  const doSend = () => {
    const body = text.trim();
    if (!body) return;
    void send(id, { text: body, contact: tag, replyTo: reply });
    setText(''); setTag(null); setReply(null);
  };
  const sendFile = (f: Picked | 'denied' | null) => {
    if (f === 'denied') { Alert.alert(t('photo'), t('cameraDenied')); return; }
    if (!f) return;
    if (f.size != null && f.size > MAX_FILE_BYTES) { Alert.alert(t('chatTitle'), t('chatTooBig')); return; }
    void send(id, { text: text.trim() || undefined, contact: tag, replyTo: reply, file: f });
    setText(''); setTag(null); setReply(null);
  };
  const attach = async (k: 'camera' | 'gallery' | 'doc') => {
    setAttachOpen(false);
    const f = k === 'camera' ? await pickCamera() : k === 'gallery' ? await pickGallery() : await pickDocument();
    sendFile(f);
  };
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
  const sub = isTeam ? t('chatTeamSub') : isDirect ? thread?.sub ?? t('chatDirectSub') : t('chatOfficeSub');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: WA.head }} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: WA.head, borderBottomWidth: 3, borderBottomColor: NX.accent }}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/chat'))} hitSlop={10} accessibilityLabel={t('back')} style={{ padding: 6 }}>
          <Icon name="back" color="#fff" size={22} />
        </Pressable>
        <ChatAvatar kind={thread?.kind ?? 'agent'} name={title} photoUrl={thread?.photoUrl} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T style={{ color: '#fff', fontSize: 17, fontWeight: '800' }} numberOfLines={1}>{title}</T>
          <T style={{ color: NX.headSub, fontSize: 12 }} numberOfLines={1}>{sub}</T>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: WA.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          inverted
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 10, gap: 3 }}
          onEndReachedThreshold={0.3}
          onEndReached={() => { if (more && msgs.length >= 30) void olderMessages(id).then(setMore).catch(() => undefined); }}
          ListFooterComponent={
            <View style={{ alignSelf: 'center', flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: C.blueSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 8, maxWidth: '92%' }}>
              <Icon name="lock" size={12} color={C.blueInk} />
              <T style={{ color: C.blueInk, fontSize: 12, textAlign: 'center' }}>{isDirect ? t('chatDirectSecure', { name: title }) : t('chatSecureNote')}</T>
            </View>
          }
          renderItem={({ item }) => item.kind === 'day' ? (
            <View style={{ alignSelf: 'center', backgroundColor: NX.chip, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginVertical: 10 }}>
              <T style={{ fontSize: 12, color: '#fff', fontWeight: '700' }}>{dayLabel(item.at, t, lang)}</T>
            </View>
          ) : (
            <Bubble m={item.m} showName={!item.m.mine && !isDirect && (isTeam || item.m.fromOffice)} readAt={marks.readAt} seenAt={marks.seenAt}
              lang={lang} t={t} onReply={() => { setReply(item.m); inputRef.current?.focus(); }} onOpenFile={() => void openFile(item.m)}
              onOpenTag={(cid) => { if (q.contact(cid)) router.push({ pathname: '/partner/[id]', params: { id: cid } }); }} />
          )}
        />

        {/* What's attached to the next message */}
        {reply || tag ? (
          <View style={{ backgroundColor: NX.bar, paddingHorizontal: 10, paddingTop: 8, gap: 6 }}>
            {reply ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderLeftWidth: 4, borderLeftColor: C.blue, borderRadius: 10, padding: 8, gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <T style={{ color: C.blueInk, fontWeight: '700', fontSize: 13 }}>{reply.mine ? t('chatYou') : reply.senderName}</T>
                  <T style={{ color: C.text2, fontSize: 13 }} numberOfLines={1}>{reply.text ?? (reply.file ? `📎 ${reply.file.name}` : '')}</T>
                </View>
                <Pressable onPress={() => setReply(null)} hitSlop={8}><Icon name="close" size={18} color="#54656f" /></Pressable>
              </View>
            ) : null}
            {tag ? (
              <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.purpleSoft, borderRadius: 999, paddingLeft: 10, paddingRight: 6, paddingVertical: 5 }}>
                <Icon name="tag" size={14} color={C.purple} />
                <T style={{ color: C.purple, fontWeight: '700', fontSize: 13 }}>{tag.name}</T>
                <Pressable onPress={() => setTag(null)} hitSlop={8}><Icon name="close" size={16} color={C.purple} /></Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Composer */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 6, paddingTop: 6, paddingBottom: emoji ? 6 : Math.max(insets.bottom, 6), backgroundColor: NX.bar, borderTopWidth: 1, borderTopColor: C.border }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: C.borderStrong, paddingHorizontal: 4, minHeight: 48 }}>
            <RoundIcon icon={emoji ? 'note' : 'smile'} onPress={toggleEmoji} label={t('chatEmoji')} />
            <TextInput ref={inputRef} value={text} onChangeText={setText} placeholder={t('chatType')} placeholderTextColor={C.muted} multiline maxLength={4000}
              onFocus={() => setEmoji(false)}
              style={{ flex: 1, fontSize: 16, color: C.text, paddingVertical: 12, paddingHorizontal: 4, maxHeight: 130 }} />
            <RoundIcon icon="tag" onPress={() => setPicking(true)} label={t('chatTagPartner')} active={!!tag} />
            <RoundIcon icon="attach" onPress={() => setAttachOpen(true)} label={t('chatAttach')} />
          </View>
          <Pressable onPress={text.trim() ? doSend : () => setAttachOpen(true)} accessibilityRole="button" accessibilityLabel={text.trim() ? t('chatSend') : t('chatAttach')}
            style={({ pressed }) => [{ width: 48, height: 48, borderRadius: 16, backgroundColor: WA.send, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.85 }]}>
            <Icon name={text.trim() ? 'send' : 'camera'} color="#fff" size={22} />
          </Pressable>
        </View>

        {/* Built-in emoji, in place of the keyboard */}
        {emoji ? (
          <View style={{ height: 270 + insets.bottom, backgroundColor: '#fff', paddingBottom: insets.bottom }}>
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f0f2f5' }}>
              {EMOJI.map((g, i) => (
                <Pressable key={g.group} onPress={() => setGroup(i)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderBottomWidth: 3, borderBottomColor: i === group ? C.blue : 'transparent' }}>
                  <T style={{ fontSize: 20 }}>{g.icon}</T>
                </Pressable>
              ))}
            </View>
            <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', padding: 6 }} keyboardShouldPersistTaps="always">
              {EMOJI[group].list.map((e) => (
                <Pressable key={e} onPress={() => setText((x) => x + e)} style={{ width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <T style={{ fontSize: 26 }}>{e}</T>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)} title={t('chatAttach')}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8 }}>
          <AttachBtn icon="camera" color="#d3396d" label={t('chatCamera')} onPress={() => void attach('camera')} />
          <AttachBtn icon="image" color="#7c3aed" label={t('chatGallery')} onPress={() => void attach('gallery')} />
          <AttachBtn icon="doc" color="#5157ae" label={t('chatDocument')} onPress={() => void attach('doc')} />
        </View>
        <T style={{ color: C.text2, fontSize: 13, textAlign: 'center' }}>{t('chatAttachHint')}</T>
      </Sheet>

      <PartnerPicker visible={picking} onClose={() => setPicking(false)} onPick={(c) => setTag({ id: c.clientId, name: c.name })} panchayatFirst={visit?.panchayatId} />

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: insets.top + 8, paddingHorizontal: 12, paddingBottom: 8 }}>
            <Pressable onPress={() => setViewer(null)} hitSlop={10}><Icon name="back" color="#fff" size={22} /></Pressable>
            <T style={{ color: '#fff', flex: 1, fontWeight: '700' }} numberOfLines={1}>{viewer?.mine ? t('chatYou') : viewer?.senderName}</T>
            {viewer ? <Pressable onPress={() => void openChatFile(viewer).catch(() => undefined)} hitSlop={10}><Icon name="download" color="#fff" size={22} /></Pressable> : null}
          </View>
          {viewer ? <Image source={imageSource(viewer)} style={{ flex: 1 }} resizeMode="contain" /> : null}
          {viewer?.text ? <T style={{ color: '#fff', padding: 16, paddingBottom: insets.bottom + 16 }}>{viewer.text}</T> : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function dayLabel(iso: string, t: ReturnType<typeof useSession>['t'], lang: ReturnType<typeof useSession>['lang']) {
  const d = new Date(iso).toDateString();
  if (d === new Date().toDateString()) return t('today');
  if (d === new Date(Date.now() - 864e5).toDateString()) return t('yesterday');
  return dayLong(lang, new Date(iso));
}

function RoundIcon({ icon, onPress, label, active }: { icon: IconName; onPress: () => void; label: string; active?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={({ pressed }) => [{ width: 42, height: 48, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={22} color={active ? C.purple : C.text2} />
    </Pressable>
  );
}

function AttachBtn({ icon, color, label, onPress }: { icon: IconName; color: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 8, width: 90 }} accessibilityRole="button" accessibilityLabel={label}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={24} color="#fff" />
      </View>
      <T style={{ fontSize: 13, color: C.text3, fontWeight: '600' }}>{label}</T>
    </Pressable>
  );
}

function Bubble({ m, showName, readAt, seenAt, lang, t, onReply, onOpenFile, onOpenTag }: {
  m: ChatMsg; showName: boolean; readAt: string | null; seenAt: string | null;
  lang: ReturnType<typeof useSession>['lang']; t: ReturnType<typeof useSession>['t'];
  onReply: () => void; onOpenFile: () => void; onOpenTag: (id: string) => void;
}) {
  const failed = m.state === 'failed';
  const pending = m.state === 'pending';
  const read = m.mine && !m.state && readAt != null && readAt >= m.createdAt;
  const seen = m.mine && !m.state && seenAt != null && seenAt >= m.createdAt;
  const isImage = !!m.file && m.file.mime.startsWith('image/');
  return (
    <Pressable onLongPress={m.state ? undefined : onReply} delayLongPress={300}
      onPress={failed ? () => Alert.alert(t('chatNotSent'), failedReason(m.clientId) ?? '', [{ text: t('cancel'), style: 'cancel' }, { text: t('chatRetry'), onPress: () => retry(m.clientId) }]) : undefined}
      style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '84%', marginVertical: 1 }}>
      <View style={{ backgroundColor: m.mine ? WA.mine : WA.theirs, borderRadius: 18, borderBottomRightRadius: m.mine ? 6 : 18, borderBottomLeftRadius: m.mine ? 18 : 6,
        padding: isImage ? 4 : 10, paddingBottom: 6, gap: 4, borderWidth: failed ? 1 : m.mine ? 0 : 1, borderColor: failed ? C.bad : C.border,
        elevation: m.mine ? 2 : 0, shadowColor: C.blue, shadowOpacity: m.mine ? 0.18 : 0, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
        {showName ? <T style={{ color: WA.name, fontWeight: '800', fontSize: 13, paddingHorizontal: isImage ? 6 : 0 }}>{m.senderName}{m.fromOffice ? ` · ${t('chatOfficeShort')}` : ''}</T> : null}
        {m.replyTo ? (
          <View style={{ backgroundColor: m.mine ? 'rgba(255,255,255,0.16)' : C.blueSoft, borderLeftWidth: 3, borderLeftColor: m.mine ? NX.accent : C.blue, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }}>
            <T style={{ color: m.mine ? NX.accent : C.blueInk, fontWeight: '800', fontSize: 12 }}>{m.replyTo.senderName}</T>
            <T style={{ color: m.mine ? NX.mineMeta : C.text2, fontSize: 13 }} numberOfLines={2}>{m.replyTo.text ?? (m.replyTo.fileName ? `📎 ${m.replyTo.fileName}` : '')}</T>
          </View>
        ) : null}
        {m.file ? (isImage ? (
          <Pressable onPress={onOpenFile}>
            <Image source={imageSource(m)} style={{ width: 240, height: 240, borderRadius: 14, backgroundColor: C.line }} resizeMode="cover" />
          </Pressable>
        ) : (
          <Pressable onPress={onOpenFile} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: m.mine ? 'rgba(255,255,255,0.14)' : C.bg, borderRadius: 12, padding: 10, minWidth: 220 }}>
            <View style={{ width: 38, height: 44, borderRadius: 8, backgroundColor: fileColor(m.file.name), alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{(m.file.name.split('.').pop() ?? '').toUpperCase().slice(0, 4)}</T>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T style={{ fontWeight: '700', fontSize: 14, color: m.mine ? '#fff' : C.text }} numberOfLines={2}>{m.file.name}</T>
              {m.file.size ? <T style={{ color: m.mine ? NX.mineMeta : WA.meta, fontSize: 12 }}>{fmtSize(m.file.size)}</T> : null}
            </View>
            <Icon name="download" size={18} color={m.mine ? '#fff' : WA.meta} />
          </Pressable>
        )) : null}
        {m.text ? <T style={{ fontSize: 15.5, lineHeight: 21, color: m.mine ? NX.mineText : NX.theirsText, paddingHorizontal: isImage ? 6 : 0 }}>{m.text}</T> : null}
        {m.contact ? (
          <Pressable onPress={() => onOpenTag(m.contact!.id)} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: m.mine ? 'rgba(255,255,255,0.18)' : C.purpleSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginHorizontal: isImage ? 6 : 0 }}>
            <Icon name="tag" size={12} color={m.mine ? '#fff' : C.purple} />
            <T style={{ color: m.mine ? '#fff' : C.purple, fontWeight: '700', fontSize: 12 }}>{m.contact.name}</T>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 3, paddingHorizontal: isImage ? 6 : 0 }}>
          <T style={{ fontSize: 11, color: m.mine ? NX.mineMeta : WA.meta }}>{timeOf(lang, m.createdAt)}</T>
          {m.mine ? (failed ? <Icon name="alert" size={14} color="#ffd1cc" />
            : pending ? <Icon name="clock" size={13} color={NX.mineMeta} />
              : read ? <Icon name="checks" size={16} color={WA.blueTick} strokeWidth={2.4} />
                : seen ? <Icon name="checks" size={16} color={NX.mineMeta} /> : <Icon name="check" size={14} color={NX.mineMeta} />) : null}
        </View>
      </View>
      {failed ? <T style={{ color: C.bad, fontSize: 12, textAlign: 'right', marginTop: 2 }}>{t('chatTapRetry')}</T> : null}
    </Pressable>
  );
}

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function fileColor(name: string) {
  const e = name.split('.').pop()?.toLowerCase() ?? '';
  return e === 'pdf' ? '#e5484d' : ['doc', 'docx'].includes(e) ? '#2b6cd6' : ['xls', 'xlsx', 'csv'].includes(e) ? '#1f8a4c' : ['ppt', 'pptx'].includes(e) ? '#d9822b' : '#5a6478';
}
