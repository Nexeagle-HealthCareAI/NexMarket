'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAgentStore } from '@/store/agent-store';
import { useContacts, usePanchayats, db } from '@/lib/db';
import type { ContactRole } from '@/lib/db/schema';
import { useLiveQuery } from 'dexie-react-hooks';

const ROLE_CLASSES: Record<ContactRole, string> = {
  asha_worker: 'role-asha',
  rmp_doctor: 'role-rmp',
  ward_member: 'role-ward',
  medicine_shop: 'role-medicine',
  mukhiya: 'role-mukhiya',
  prominent_person: 'role-prominent',
  lab: 'role-medicine',
  nursing_home: 'role-medicine',
  independent_doctor: 'role-rmp',
  hospital: 'role-medicine',
  other: 'role-prominent',
};

import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from '@/i18n/I18nProvider';
import { Pin, PinOff } from 'lucide-react';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
};

const itemVariants = {
  hidden: { y: 10, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.3 } }
};

export default function ContactsPage() {
  const router = useRouter();
  const agentId = useAgentStore((s) => s.agentId);
  const contacts = useContacts(agentId ?? undefined);
  const panchayats = usePanchayats();
  const t = useTranslations();

  // Check for unsaved draft in Dexie
  const savedDraft = useLiveQuery(() => db.drafts.get('newContactDraft'));
  const hasDraft = !!(savedDraft?.data?.name || savedDraft?.data?.phone || savedDraft?.data?.role);
  const draftName = savedDraft?.data?.name as string | undefined;
  const draftRole = savedDraft?.data?.role as string | undefined;

  async function discardDraft() {
    await db.drafts.delete('newContactDraft');
  }

  const ROLE_LABELS: Record<ContactRole, string> = {
    asha_worker: t.roleAshaWorker,
    rmp_doctor: t.roleRmpDoctor,
    ward_member: t.roleWardMember,
    medicine_shop: t.roleMedicineShop,
    mukhiya: t.roleMukhiya,
    prominent_person: t.roleProminentPerson,
    lab: t.roleLab,
    nursing_home: t.roleNursingHome,
    independent_doctor: t.roleIndependentDoctor,
    hospital: t.roleHospital,
    other: t.roleOther,
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<ContactRole | 'all'>('all');
  
  const [selectedDistrict, setSelectedDistrict] = useState<string>('');
  const [selectedBlock, setSelectedBlock] = useState<string>('');
  const [selectedPanchayat, setSelectedPanchayat] = useState<string>('');

  const pinnedContactIds = useAgentStore((s) => s.pinnedContactIds || []);
  const togglePinContact = useAgentStore((s) => s.togglePinContact);

  const uniqueDistricts = useMemo(() => {
    if (!panchayats) return [];
    return Array.from(new Set(panchayats.map(p => p.district))).sort();
  }, [panchayats]);

  const uniqueBlocks = useMemo(() => {
    if (!panchayats) return [];
    return Array.from(new Set(
      panchayats.filter(p => !selectedDistrict || p.district === selectedDistrict).map(p => p.block)
    )).sort();
  }, [panchayats, selectedDistrict]);

  const filteredPanchayats = useMemo(() => {
    if (!panchayats) return [];
    return panchayats.filter(p => 
      (!selectedDistrict || p.district === selectedDistrict) &&
      (!selectedBlock || p.block === selectedBlock)
    ).sort((a,b) => a.name.localeCompare(b.name));
  }, [panchayats, selectedDistrict, selectedBlock]);

  const panchayatMap = useMemo(() => {
    const map = new Map<string, string>();
    panchayats?.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [panchayats]);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    return contacts.filter((c) => {
      const panchayat = panchayats?.find(p => p.id === c.panchayatId);
      
      const matchesDistrict = !selectedDistrict || panchayat?.district === selectedDistrict;
      const matchesBlock = !selectedBlock || panchayat?.block === selectedBlock;
      const matchesPanchayat = !selectedPanchayat || c.panchayatId === selectedPanchayat;

      const matchesRole = roleFilter === 'all' || c.role === roleFilter;
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        !query ||
        c.name.toLowerCase().includes(query) ||
        (c.phone && c.phone.includes(query)) ||
        (panchayatMap.get(c.panchayatId) ?? '').toLowerCase().includes(query);
      return matchesRole && matchesSearch && matchesDistrict && matchesBlock && matchesPanchayat;
    });
  }, [contacts, roleFilter, searchQuery, panchayatMap, panchayats, selectedDistrict, selectedBlock, selectedPanchayat]);

  const sortedFiltered = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aPinned = pinnedContactIds.includes(a.clientId);
      const bPinned = pinnedContactIds.includes(b.clientId);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [filtered, pinnedContactIds]);

  return (
    <motion.div initial="hidden" animate="visible" variants={containerVariants}>
      <motion.div variants={itemVariants} className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>{t.contactsPageTitle}</h1>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Link href="/contacts/new" className="btn btn-primary btn-sm" id="add-contact-btn">
              {t.btnAdd}
            </Link>
          </motion.div>
        </div>
      </motion.div>

      {/* Draft Resume Banner */}
      {hasDraft && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
            border: '1.5px solid #f59e0b',
            borderRadius: 'var(--radius-md)',
            padding: '0.85rem 1rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 700, color: '#92400e', fontSize: '0.85rem', margin: 0 }}>📝 Unsaved draft</p>
            <p style={{ color: '#b45309', fontSize: '0.78rem', margin: '0.15rem 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {draftName ? `"${draftName}"` : draftRole ? `Role: ${draftRole}` : 'Incomplete contact entry'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button
              onClick={discardDraft}
              style={{ background: 'rgba(0,0,0,0.08)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.7rem', fontSize: '0.78rem', fontWeight: 600, color: '#78350f', cursor: 'pointer' }}
            >
              Discard
            </button>
            <button
              onClick={() => router.push('/contacts/new')}
              style={{ background: '#d97706', border: 'none', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.85rem', fontSize: '0.78rem', fontWeight: 700, color: 'white', cursor: 'pointer' }}
            >
              Resume →
            </button>
          </div>
        </motion.div>
      )}

      <motion.div variants={itemVariants} className="field-group" style={{ marginBottom: '0.75rem' }}>
        <input
          id="contact-search"
          className="field-input"
          type="search"
          placeholder={t.searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </motion.div>

            {/* Location filters */}
      <motion.div variants={itemVariants} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select 
          className="field-input" 
          style={{ flex: '1 1 120px', padding: '0.4rem', fontSize: '0.85rem' }}
          value={selectedDistrict} 
          onChange={(e) => { setSelectedDistrict(e.target.value); setSelectedBlock(''); setSelectedPanchayat(''); }}
        >
          <option value="">All Districts</option>
          {uniqueDistricts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select 
          className="field-input" 
          style={{ flex: '1 1 120px', padding: '0.4rem', fontSize: '0.85rem' }}
          value={selectedBlock} 
          onChange={(e) => { setSelectedBlock(e.target.value); setSelectedPanchayat(''); }}
          disabled={!selectedDistrict && uniqueBlocks.length === 0}
        >
          <option value="">All Blocks</option>
          {uniqueBlocks.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select 
          className="field-input" 
          style={{ flex: '1 1 120px', padding: '0.4rem', fontSize: '0.85rem' }}
          value={selectedPanchayat} 
          onChange={(e) => setSelectedPanchayat(e.target.value)}
        >
          <option value="">All Panchayats</option>
          {filteredPanchayats.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </motion.div>

      {/* Role filter chips */}
      <motion.div variants={itemVariants} style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
        {(['all', 'asha_worker', 'rmp_doctor', 'ward_member', 'medicine_shop', 'mukhiya', 'prominent_person', 'lab', 'nursing_home', 'independent_doctor', 'hospital', 'other'] as const).map((role) => (
          <button
            key={role}
            id={`filter-${role}`}
            onClick={() => setRoleFilter(role)}
            style={{
              padding: '0.3rem 0.8rem',
              borderRadius: 'var(--radius-full)',
              border: '1.5px solid',
              borderColor: roleFilter === role ? 'var(--color-primary-500)' : 'var(--surface-border)',
              background: roleFilter === role ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: roleFilter === role ? 'var(--color-primary-600)' : 'var(--text-muted)',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 120ms ease',
            }}
          >
            {role === 'all' ? t.filterAll : ROLE_LABELS[role]}
          </button>
        ))}
      </motion.div>

      {/* Count */}
      <motion.p variants={itemVariants} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        {filtered.length} {filtered.length !== 1 ? t.contactCountPlural : t.contactCount}
      </motion.p>

      {/* List */}
      <AnimatePresence>
        {filtered.length === 0 ? (
          <motion.div 
            key="empty"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="empty-state"
          >
            <div className="empty-state-icon">👤</div>
            <h3>{t.noContactsYet}</h3>
            <p style={{ fontSize: '0.85rem' }}>{t.addContactsDesc}</p>
            <Link href="/contacts/new" className="btn btn-primary btn-lg" style={{ marginTop: '1rem' }}>
              {t.addFirstContact || 'Start by Adding a Contact'}
            </Link>
          </motion.div>
        ) : (
          <motion.div key="list" variants={containerVariants} initial="hidden" animate="visible" className="grid-cols-responsive-2">
            {sortedFiltered.map((contact) => (
              <motion.div variants={itemVariants} key={contact.clientId} layoutId={`contact-${contact.clientId}`}>
                <Link
                  href={`/contacts/${contact.clientId}`}
                  style={{ textDecoration: 'none' }}
                >
                  <motion.div whileHover={{ y: -3, boxShadow: '0 6px 16px rgba(0,0,0,0.06)' }} className="card">
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                          <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                            {contact.name}
                          </p>
                          {pinnedContactIds.includes(contact.clientId) && (
                            <Pin size={14} fill="currentColor" color="var(--color-primary-600)" />
                          )}
                          {contact.potentialDuplicateOf?.length ? (
                            <span className="badge badge-dup">{t.dupBadge}</span>
                          ) : null}
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          📍 {panchayatMap.get(contact.panchayatId) ?? t.unknownPanchayat}
                        </p>
                        {contact.phone && (
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                            📞 {contact.phone}
                          </p>
                        )}
                        <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                          {contact.whatsappAdded && (
                            <span className="badge" style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--color-success)' }}>{t.whatsappBadge}</span>
                          )}
                          {contact.cardGiven && (
                            <span className="badge" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--color-primary-600)' }}>{t.cardBadge}</span>
                          )}
                          {contact.syncedAt ? (
                            <span style={{ fontSize: '0.9rem', color: '#10b981' }} title="Synced to Cloud">☁️</span>
                          ) : (
                            <span className="badge badge-pending" style={{ background: '#fef3c7', color: '#d97706' }} title="Pending Sync">🌩️ Unsynced</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                        <button
                          onClick={(e) => {
                            e.preventDefault(); // prevent navigation
                            togglePinContact(contact.clientId);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: pinnedContactIds.includes(contact.clientId) ? 'var(--color-primary-600)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '0.2rem',
                          }}
                          title={pinnedContactIds.includes(contact.clientId) ? "Unpin Contact" : "Pin Contact"}
                        >
                          {pinnedContactIds.includes(contact.clientId) ? <Pin size={18} fill="currentColor" /> : <Pin size={18} />}
                        </button>
                        <span className={`role-chip ${ROLE_CLASSES[contact.role]}`}>
                          {ROLE_LABELS[contact.role]}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
