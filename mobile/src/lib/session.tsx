import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getLocales } from 'expo-localization';
import { clearTokens, ensureDeviceId, loadTokens, login as apiLogin, logoutRemote, setSignedOutHandler, type LoginResult } from './api';
import { dbVersion, kvGet, kvSet, onDbChange, wipeAll } from './db';
import { translate, type Lang, type TFn } from '../i18n';
import { uuid } from './util';
import { onSyncState, startAutoSync, stopAutoSync, syncNow, syncState, type SyncState } from './sync';
import { stopTracking } from './location';

/**
 * App-wide state: who is signed in and which language they read. The language lives in
 * SQLite (kv) so it is ready before the first screen draws, and survives logout.
 */

export interface Agent { agentId: string; name: string; district: string; block: string }

interface Session {
  ready: boolean;
  agent: Agent | null;
  lang: Lang;
  setLang(l: Lang): void;
  t: TFn;
  signIn(userId: string, password: string): Promise<LoginResult>;
  signOut(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);

function defaultLang(): Lang {
  const saved = kvGet('lang') as Lang | null;
  if (saved && ['hi', 'hinglish', 'bn', 'en'].includes(saved)) return saved;
  // Hindi is the default; a phone set to Bengali starts in Bengali.
  const code = getLocales()[0]?.languageCode;
  return code === 'bn' ? 'bn' : 'hi';
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [lang, setLangState] = useState<Lang>(() => defaultLang());
  const langRef = useRef(lang);
  langRef.current = lang;

  const setLang = useCallback((l: Lang) => {
    kvSet('lang', l);
    setLangState(l);
  }, []);

  const t = useCallback<TFn>((key, vars) => translate(lang, key, vars), [lang]);

  const resetLocal = useCallback(async () => {
    stopAutoSync();
    await stopTracking();
    await clearTokens();
    const keep = langRef.current;
    wipeAll();
    kvSet('lang', keep); // the language choice outlives the session
    setAgent(null);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { agentId } = await loadTokens();
      const stored = kvGet('agent');
      if (agentId && stored) {
        try {
          const a = JSON.parse(stored) as Agent;
          if (alive && a.agentId === agentId) {
            setAgent(a);
            startAutoSync();
            void syncNow(true);
          }
        } catch { /* fall through to login */ }
      }
      if (alive) setReady(true);
    })();
    // The server ended this session (password changed, phone signed out by admin…). Keep
    // everything on the phone — the same agent signing in again sends it — but stop work.
    setSignedOutHandler(() => {
      stopAutoSync();
      void clearTokens();
      setAgent(null);
    });
    return () => { alive = false; setSignedOutHandler(null); };
  }, [resetLocal]);

  const signIn = useCallback(async (userId: string, password: string) => {
    const deviceId = await ensureDeviceId(uuid);
    const r = await apiLogin(userId, password, deviceId);
    const prev = kvGet('agentId');
    if (prev && prev !== r.agentId) {
      // A different person on this phone: start clean.
      const keep = langRef.current;
      wipeAll();
      kvSet('lang', keep);
    }
    const a: Agent = { agentId: r.agentId, name: r.name, district: r.district ?? '', block: r.block ?? '' };
    kvSet('agentId', r.agentId);
    kvSet('deviceId', r.deviceId || deviceId);
    kvSet('agent', JSON.stringify(a));
    await syncNow(true);
    startAutoSync();
    setAgent(a);
    return r;
  }, []);

  const signOut = useCallback(async () => {
    await logoutRemote();
    await resetLocal();
  }, [resetLocal]);

  const value = useMemo<Session>(() => ({ ready, agent, lang, setLang, t, signIn, signOut }),
    [ready, agent, lang, setLang, t, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

export function useT(): TFn {
  return useSession().t;
}

/** Re-runs `read` whenever anything in the local database changes. */
export function useDb<T>(read: () => T, deps: React.DependencyList = []): T {
  const version = useSyncExternalStore(onDbChange, dbVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(read, [version, ...deps]);
}

export function useSync(): SyncState {
  return useSyncExternalStore(onSyncState, syncState);
}
