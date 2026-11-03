import React from 'react';
import { View } from 'react-native';
import { Avatar } from './ui';
import { Icon } from './Icon';
import { C } from '../theme';

/** NexEagle chat look: navy header with a mint line, blue bubbles for me, white for others. */
export const NX = {
  head: C.ink, headSub: 'rgba(255,255,255,0.72)', accent: C.mint,
  bg: '#eaf0f7', mine: C.blue, mineText: '#ffffff', mineMeta: 'rgba(255,255,255,0.78)',
  theirs: '#ffffff', theirsText: C.text, meta: '#6b7489', read: C.mint, name: C.blueInk,
  composer: '#ffffff', bar: '#f7f9fc', chip: 'rgba(14,21,37,0.72)',
};

/** Avatar for a chat: the person (photo or initials), the office, or the field team. */
export function ChatAvatar({ kind, name, photoUrl, size = 48, ring }: { kind: 'agent' | 'team' | 'direct'; name: string; photoUrl?: string | null; size?: number; ring?: boolean }) {
  const border = ring ? { borderWidth: 2, borderColor: NX.accent, borderRadius: size } : null;
  if (kind === 'direct') return <View style={border}><Avatar name={name} uri={photoUrl} size={size} bg={C.blueInk} /></View>;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: kind === 'team' ? C.ink2 : C.blue }, border]}>
      <Icon name={kind === 'team' ? 'users' : 'hospital'} color={kind === 'team' ? NX.accent : '#fff'} size={size * 0.46} />
    </View>
  );
}
