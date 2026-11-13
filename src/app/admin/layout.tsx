'use client';

import VitaChat, { openVita } from '@/components/crm/VitaChat';
import { NotificationBell, NotificationPopups, NOTIFY_EVENT } from '@/components/crm/NotificationBell';
import CallLayer from '@/components/crm/calls/CallLayer';
import type { LiveNotification } from '@/lib/crm/live';
import './crm.css';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
import {
  LayoutDashboard, PhoneCall, Columns3, Users, MessageCircle, MapPin, Smartphone, ClipboardList,
  Wallet, BarChart3, ListChecks, Building2, Landmark, ShieldCheck, RefreshCw, LogOut, Menu, MoreHorizontal,
  PanelLeftClose, PanelLeftOpen, Activity, Grid2x2Check, CalendarCheck, History, MessagesSquare, ChevronRight, UserPlus, Tent,
  AtSign, Search, Route, Signpost, KanbanSquare, Download,
} from 'lucide-react';
import { crm, logout as apiLogout, setSessionExpiredHandler } from '@/lib/sync/api-client';
import { useLiveEvents } from '@/lib/crm/live';
import { usePresenceBeat } from '@/lib/crm/presence';
import { useAgentStore } from '@/store/agent-store';
import { canView, clearAccess, isDashboardRole, orgName, ROLE_LABELS, useAccess, type PageKey } from '@/lib/crm/access';
import { initials } from '@/components/crm/ui';

type IconType = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;

interface NavItem {
  href: string;
  label: string;
  page: PageKey | 'admin' | 'chat' | 'leads' | 'wa' | 'referrals' | 'everyone' | 'ai' | 'platform';
  icon: IconType;
  /** extra paths that should highlight this item */
  match?: string[];
  phone?: boolean; // shown in the phone bottom bar when allowed
}

/** Vita, the NexEagle mascot, as the sidebar icon for the autonomous agents. */
function VitaIcon({ size = 18 }: { size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/vita/ai.webp" alt="" aria-hidden width={size + 4} height={size + 4} style={{ objectFit: 'contain', margin: -2 }} />;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Overview',
    items: [
      { href: '/admin/dashboard', label: 'Command centre', page: 'dashboard', icon: LayoutDashboard, phone: true },
      { href: '/admin/work', label: 'Team board', page: 'work', icon: KanbanSquare },
      { href: '/admin/ai-agents', label: 'Vita marketing agents', page: 'ai', icon: VitaIcon },
      { href: '/admin/leads', label: 'Leads inbox', page: 'leads', icon: UserPlus, phone: true },
      { href: '/admin/calls', label: 'Daily calls', page: 'calls', icon: PhoneCall, phone: true },
      { href: '/admin/referrals', label: 'Referrals', page: 'referrals', icon: Columns3, match: ['/admin/hospital-crm', '/admin/desk'], phone: true },
    ],
  },
  {
    group: 'Network',
    items: [
      { href: '/admin/partners', label: 'Partners', page: 'partners', icon: Users, match: ['/admin/pipeline', '/admin/duplicates'] },
      { href: '/admin/camps', label: 'Health camps', page: 'camps', icon: Tent },
      { href: '/admin/whatsapp', label: 'WhatsApp', page: 'wa', icon: MessageCircle, match: ['/admin/broadcasts', '/admin/whatsapp-setup'] },
      { href: '/admin/social', label: 'Facebook & Instagram', page: 'social', icon: AtSign },
      { href: '/admin/google', label: 'Google', page: 'social', icon: Search },
    ],
  },
  {
    group: 'Field force',
    items: [
      { href: '/admin/chat', label: 'Chat', page: 'chat', icon: MessagesSquare, phone: true },
      { href: '/admin/map', label: 'Live map', page: 'field', icon: MapPin },
      { href: '/admin/activity', label: 'Agent activity', page: 'field', icon: Activity },
      { href: '/admin/coverage', label: 'Panchayat coverage', page: 'field', icon: Grid2x2Check, match: ['/admin/panchayats'] },
      { href: '/admin/field-surveys', label: 'Field mapping', page: 'field', icon: Route },
      { href: '/admin/hoardings', label: 'Hoardings', page: 'hoardings', icon: Signpost },
      { href: '/admin/leave', label: 'Attendance & leave', page: 'field', icon: CalendarCheck },
      { href: '/admin/agents', label: 'Field agents', page: 'field', icon: Smartphone },
      { href: '/admin/app', label: 'Field app', page: 'everyone', icon: Download },
      { href: '/admin/assignments', label: 'Block assignments', page: 'field', icon: ClipboardList },
    ],
  },
  {
    group: 'Money & growth',
    items: [
      { href: '/admin/payments', label: 'Payments', page: 'payments', icon: Wallet },
      { href: '/admin/reports', label: 'Analytics', page: 'analytics', icon: BarChart3 },
      { href: '/admin/surveys', label: 'Surveys', page: 'analytics', icon: ListChecks },
    ],
  },
  {
    group: 'Settings',
    items: [
      { href: '/admin/departments', label: 'Departments & doctors', page: 'departments', icon: Building2 },
      { href: '/admin/users', label: 'Users & roles', page: 'users', icon: ShieldCheck },
      { href: '/admin/audit', label: 'Activity log', page: 'admin', icon: History },
      { href: '/admin/sync', label: 'Sync health', page: 'admin', icon: RefreshCw },
      { href: '/admin/platform', label: 'Organisations', page: 'platform', icon: Landmark },
    ],
  },
];

// Desktop sidebar collapsed/expanded — remembered per browser.
const COLLAPSE_KEY = 'crm-sidebar-collapsed';
const collapseListeners = new Set<() => void>();
function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}
function writeCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* storage blocked: still toggles for this visit */ }
  memCollapsed = v;
  collapseListeners.forEach((l) => l());
}
let memCollapsed: boolean | null = null;
function useSidebarCollapsed(): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => { collapseListeners.add(cb); return () => { collapseListeners.delete(cb); }; },
    () => memCollapsed ?? (memCollapsed = readCollapsed()),
    () => false,
  );
  return [value, writeCollapsed];
}

function isActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href || pathname.startsWith(item.href + '/')) {
    // /admin/sync/dlq still highlights Sync; but /admin/pipeline must not swallow /admin/referrals
    return true;
  }
  return (item.match ?? []).some((m) => pathname.startsWith(m));
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsed, setCollapsed] = useSidebarCollapsed(); // desktop
  const [railOpen, setRailOpen] = useState(false); // tablet: rail expanded over the page

  const agentId = useAgentStore((s) => s.agentId);
  const name = useAgentStore((s) => s.name);
  const role = useAgentStore((s) => s.role);
  const hasHydrated = useAgentStore((s) => s.hasHydrated);
  const clearAuth = useAgentStore((s) => s.clearAuth);
  const { access, error: accessError } = useAccess();
  // Online / last seen in chat: a heartbeat while this tab is open.
  usePresenceBeat(hasHydrated && !!agentId);

  const handleLogout = () => {
    void apiLogout().catch(() => {});
    clearAccess();
    clearAuth();
    router.push('/login');
  };

  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearAccess();
      clearAuth();
      router.replace('/login');
    });
    return () => setSessionExpiredHandler(null);
  }, [clearAuth, router]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!agentId) {
      router.replace('/login');
      return;
    }
    // Field agents work only in the agent app — never the dashboard.
    if (role && !isDashboardRole(role)) router.replace('/home');
  }, [hasHydrated, agentId, role, router]);

  // Close the phone "More" sheet on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMoreOpen(false);
    setRailOpen(false);
  }

  useEffect(() => {
    if (!railOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRailOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railOpen]);

  // One button: on desktop it collapses/expands; on tablet it opens/closes the rail panel.
  const toggleSidebar = () => {
    if (window.matchMedia('(min-width: 1200px)').matches) setCollapsed(!collapsed);
    else setRailOpen((o) => !o);
  };

  const groups = useMemo(() => NAV.map((g) => ({
    group: g.group,
    // Chat: everyone who signs in to the CRM (Team and one-to-one chats; the office chats need field access, decided by the API).
    // Team board: office roles by default; an admin can change it in Users & roles.
    // Vita marketing autonomous agents: admins and marketing managers (same rule as the API).
    items: g.items.filter((i) => (i.page === 'everyone' ? !!access : i.page === 'platform' ? !!access?.isPlatformOwner : i.page === 'admin' ? !!access?.isAdmin
      : i.page === 'ai' ? !!access && (access.isAdmin || access.role === 'MarketingManager')
      : i.page === 'chat' ? !!access
        // Leads: whoever works the Referral desk or WhatsApp (same rule as the API).
        : i.page === 'leads' || i.page === 'wa' ? canView(access, 'desk') || canView(access, 'whatsapp')
          // Referrals: the front desk and the pipeline are one board now.
          : i.page === 'referrals' ? canView(access, 'desk') || canView(access, 'pipeline')
            : canView(access, i.page))),
  })).filter((g) => g.items.length > 0), [access]);

  const allowedItems = groups.flatMap((g) => g.items);

  // Unread chat messages, for the badge on Chat.
  // Same rule as the Chat item in the menu: anyone who can open the chat page.
  const chatAllowed = !!access;
  const [chatUnread, setChatUnread] = useState(0);
  const refreshUnread = useCallback(() => {
    if (!chatAllowed) return;
    crm.get<{ total: number }>('/api/v1/chat/unread').then((r) => setChatUnread(r.total)).catch(() => undefined);
  }, [chatAllowed]);
  useEffect(() => {
    const first = setTimeout(refreshUnread, 0);
    const t = setInterval(() => { if (!document.hidden) refreshUnread(); }, 30000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [refreshUnread, pathname]);
  // New leads and unread WhatsApp messages, for the badge on Leads inbox.
  const leadsAllowed = canView(access, 'desk') || canView(access, 'whatsapp');
  const [leadsUnread, setLeadsUnread] = useState(0);
  const refreshLeads = useCallback(() => {
    if (!leadsAllowed) return;
    crm.get<{ unread: number; counts: Record<string, number> }>('/api/v1/leads?status=new&pageSize=1')
      .then((r) => setLeadsUnread(Math.max(r.unread, r.counts.new ?? 0))).catch(() => undefined);
  }, [leadsAllowed]);
  useEffect(() => {
    const first = setTimeout(refreshLeads, 0);
    const t = setInterval(() => { if (!document.hidden) refreshLeads(); }, 45000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [refreshLeads, pathname]);
  // Unread Facebook and Instagram messages, for the badge on Facebook & Instagram.
  const socialAllowed = canView(access, 'social');
  const [socialUnread, setSocialUnread] = useState(0);
  const refreshSocial = useCallback(() => {
    if (!socialAllowed) return;
    crm.get<{ unread: number }>('/api/v1/social/status').then((r) => setSocialUnread(r.unread)).catch(() => undefined);
  }, [socialAllowed]);
  useEffect(() => {
    const first = setTimeout(refreshSocial, 0);
    const t = setInterval(() => { if (!document.hidden) refreshSocial(); }, 60000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [refreshSocial, pathname]);
  const noop = useCallback(() => {}, []);
  // My notifications arrive on the same socket; the bell (and any page) listens for them on window.
  const onNotify = useCallback((n: LiveNotification) => {
    window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, { detail: n }));
    if (n.kind === 'chat' || n.kind === 'team_chat') refreshUnread();
    if (n.kind === 'lead') { refreshLeads(); refreshSocial(); }
  }, [refreshUnread, refreshLeads, refreshSocial]);
  // Chat pings come in bursts (a message, then each reader's receipt): count once they settle.
  const unreadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChatPing = useCallback(() => {
    if (unreadTimer.current) clearTimeout(unreadTimer.current);
    unreadTimer.current = setTimeout(() => { unreadTimer.current = null; refreshUnread(); }, 1500);
  }, [refreshUnread]);
  useEffect(() => () => { if (unreadTimer.current) clearTimeout(unreadTimer.current); }, []);
  useLiveEvents(noop, undefined, onChatPing, onNotify);
  const current = allowedItems.find((i) => isActive(pathname, i));
  const phoneItems = allowedItems.filter((i) => i.phone).slice(0, 4);
  const moreItems = allowedItems.filter((i) => !phoneItems.includes(i));

  // Opening a page this role can't see → send them to the first page they can.
  const blocked = !!access && !current && pathname !== '/admin' && allowedItems.length > 0
    && NAV.some((g) => g.items.some((i) => isActive(pathname, i)));
  useEffect(() => {
    if (blocked) router.replace(allowedItems[0].href);
  }, [blocked, allowedItems, router]);

  const roleLabel = ROLE_LABELS[access?.role ?? ''] ?? access?.role ?? '';

  if (!hasHydrated || (!access && !accessError)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#f5f6f9' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e3e6ee', borderTopColor: '#0a72d6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} aria-label="Loading" />
      </div>
    );
  }

  if (accessError && !access) {
    return (
      <div className="crm" style={{ alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="crm-card" style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 className="crm-h2">Can&apos;t open the dashboard</h1>
          <p className="crm-sub">We couldn&apos;t check your access. Check your connection and try again.</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="crm-btn" onClick={() => window.location.reload()}>Try again</button>
            <button type="button" className="crm-btn is-secondary" onClick={handleLogout}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="crm">
      {railOpen && <div className="crm-side-backdrop" onClick={() => setRailOpen(false)} />}
      <nav className={`crm-side${collapsed ? ' is-collapsed' : ''}${railOpen ? ' is-open' : ''}`} aria-label="Main">
        <div className="crm-brand">
          <Image src="/brand/nexeagle-mark.png" alt="" width={40} height={40} className="crm-brand-mark" priority unoptimized />
          <div className="crm-brand-text">
            <span className="crm-brand-name">NexEagle</span>
            <span className="crm-brand-sub">{orgName('full')}</span>
          </div>
          <button type="button" className="crm-icon-btn crm-collapse-btn" onClick={toggleSidebar}
            aria-label="Collapse or expand sidebar" title="Collapse or expand sidebar">
            <span className="crm-collapse-when-open"><PanelLeftClose size={18} aria-hidden /></span>
            <span className="crm-collapse-when-rail"><PanelLeftOpen size={18} aria-hidden /></span>
          </button>
        </div>

        {groups.map((g) => (
          <div className="crm-nav-group" key={g.group}>
            <span className="crm-nav-label">{g.group}</span>
            {g.items.map((item) => {
              const Icon = item.icon;
              const active = current === item;
              return (
                <Link key={item.href} href={item.href} className="crm-nav-item" aria-current={active ? 'page' : undefined} title={item.label}>
                  <Icon size={18} strokeWidth={2} aria-hidden />
                  <span className="crm-nav-text">{item.label}</span>
                  {item.page === 'chat' && chatUnread > 0 && <span className="crm-nav-badge" aria-label={`${chatUnread} unread`}>{chatUnread > 99 ? '99+' : chatUnread}</span>}
                  {item.page === 'social' && socialUnread > 0 && <span className="crm-nav-badge is-lead" aria-label={`${socialUnread} unread`}>{socialUnread > 99 ? '99+' : socialUnread}</span>}
                  {item.page === 'leads' && leadsUnread > 0 && <span className="crm-nav-badge is-lead" aria-label={`${leadsUnread} new`}>{leadsUnread > 99 ? '99+' : leadsUnread}</span>}
                </Link>
              );
            })}
          </div>
        ))}

        <div className="crm-user">
          <div className="crm-avatar" aria-hidden="true">{initials(name)}</div>
          <div className="crm-user-text">
            <span className="crm-user-name">{name ?? agentId}</span>
            <span className="crm-user-role">{roleLabel}</span>
          </div>
          <button type="button" className="crm-icon-btn" onClick={handleLogout} aria-label="Sign out" title="Sign out">
            <LogOut size={18} aria-hidden />
          </button>
        </div>
      </nav>

      <div className="crm-main">
        {/* Desktop top bar: where you are, Vita, messages, notifications, you. */}
        <header className="crm-topnav">
          <nav className="crm-crumbs" aria-label="Breadcrumb">
            <span>{groups.find((g) => g.items.includes(current as never))?.group ?? 'NexEagle'}</span>
            <ChevronRight size={14} aria-hidden />
            <strong>{current?.label ?? 'Dashboard'}</strong>
          </nav>
          <span style={{ flex: 1 }} />
          {canView(access, 'analytics') && (
            <button type="button" className="crm-vita-btn" onClick={() => openVita('vita')} title="Ask Vita, the market analyst">
              <Image src="/brand/vita/wave.webp" alt="" width={34} height={34} unoptimized />
              <span><strong>Ask Vita</strong><small>Market analyst</small></span>
            </button>
          )}
          {chatAllowed && (
            <button type="button" className="crm-top-icon" onClick={() => openVita('messages')} aria-label={chatUnread ? `Messages, ${chatUnread} unread` : 'Messages'} title="Messages">
              <MessagesSquare size={19} aria-hidden />
              {chatUnread > 0 && <span className="nt-count">{chatUnread > 99 ? '99+' : chatUnread}</span>}
            </button>
          )}
          <NotificationBell placement="nav" />
          <span className="crm-top-user" title={`${name ?? agentId} · ${roleLabel}`}>
            <span className="crm-avatar" aria-hidden="true">{initials(name)}</span>
            <span className="crm-top-user-text"><strong>{name ?? agentId}</strong><small>{roleLabel}</small></span>
          </span>
        </header>

        <div className="crm-topbar">
          <Image src="/brand/nexeagle-mark.png" alt="NexEagle" width={34} height={34} className="crm-brand-mark" style={{ width: 34, height: 34 }} priority unoptimized />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 12, color: '#aeb7ca', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>NexEagle · {access?.orgFirst === false ? orgName() : 'Glisan Akbari SuperSpeciality'}</span>
            <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 700, fontSize: 16 }}>{current?.label ?? 'Dashboard'}</span>
          </div>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }} className="crm-top-bell">
            {canView(access, 'analytics') && (
              <button type="button" className="crm-icon-btn crm-vita-mini" onClick={() => openVita('vita')} aria-label="Ask Vita, the market analyst">
                <Image src="/brand/vita/wave.webp" alt="" width={30} height={30} unoptimized />
              </button>
            )}
            <NotificationBell placement="inline" />
          </span>
          <button type="button" className="crm-icon-btn" onClick={handleLogout} aria-label="Sign out">
            <LogOut size={18} aria-hidden />
          </button>
        </div>

        {children}
      </div>

      <VitaChat />
      <NotificationPopups />
      <CallLayer />

      <nav className="crm-bottom" aria-label="Main">
        {phoneItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} aria-current={current === item ? 'page' : undefined}>
              <Icon size={22} aria-hidden />
              {item.label.replace('Command centre', 'Home').replace('Referral pipeline', 'Pipeline').replace('Referral desk', 'Desk').replace('Daily calls', 'Calls')}
            </Link>
          );
        })}
        {moreItems.length > 0 && (
          <button type="button" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen} aria-current={current && moreItems.includes(current) ? 'page' : undefined}>
            <MoreHorizontal size={22} aria-hidden />
            More
          </button>
        )}
      </nav>

      {moreOpen && (
        <>
          <div className="crm-backdrop" onClick={() => setMoreOpen(false)} />
          <nav className="crm-more-sheet" aria-label="More pages">
            {moreItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} aria-current={current === item ? 'page' : undefined}>
                  <Icon size={22} aria-hidden />
                  {item.label}
                </Link>
              );
            })}
            <button type="button" className="crm-btn is-secondary" style={{ gridColumn: '1 / -1', marginTop: 8 }} onClick={() => setMoreOpen(false)}>
              <Menu size={16} aria-hidden /> Close
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
