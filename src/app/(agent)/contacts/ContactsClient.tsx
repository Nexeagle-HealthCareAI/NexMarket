'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAgentStore } from '@/store/agent-store';
import { useContacts, usePanchayats } from '@/lib/db';
import type { ContactRole } from '@/lib/db/schema';



const ROLE_CLASSES: Record<ContactRole, string> = {
  asha_worker: 'role-asha',
  rmp_doctor: 'role-rmp',
  ward_member: 'role-ward',
  medicine_shop: 'role-medicine',
  mukhiya: 'role-mukhiya',
  prominent_person: 'role-prominent',
};

import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from '@/i18n/I18nProvider';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
};

const itemVariants = {
  hidden: { y: 10, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.3 } }
};

export default function ContactsPage() {
  const agentId = useAgentStore((s) => s.agentId);
  const contacts = useContacts(agentId ?? undefined);
  const panchayats = usePanchayats();
  const t = useTranslations();

  const ROLE_LABELS: Record<ContactRole, string> = {
    asha_worker: t.roleAshaWorker,
    rmp_doctor: t.roleRmpDoctor,
    ward_member: t.roleWardMember,
    medicine_shop: t.roleMedicineShop,
    mukhiya: t.roleMukhiya,
    prominent_person: t.roleProminentPerson,
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<ContactRole | 'all'>('all');

  const panchayatMap = useMemo(() => {
    const map = new Map<string, string>();
    panchayats?.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [panchayats]);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    return contacts.filter((c) => {
      const matchesRole = roleFilter === 'all' || c.role === roleFilter;
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        !query ||
        c.name.toLowerCase().includes(query) ||
        c.phone?.includes(query) ||
        (panchayatMap.get(c.panchayatId) ?? '').toLowerCase().includes(query);
      return matchesRole && matchesSearch;
    });
  }, [contacts, roleFilter, searchQuery, panchayatMap]);

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

      {/* Search */}
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

      {/* Role filter chips */}
      <motion.div variants={itemVariants} style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
        {(['all', 'asha_worker', 'rmp_doctor', 'ward_member', 'medicine_shop', 'mukhiya', 'prominent_person'] as const).map((role) => (
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
            <Link href="/contacts/new" className="btn btn-primary btn-sm" style={{ marginTop: '0.5rem' }}>
              {t.addFirstContact}
            </Link>
          </motion.div>
        ) : (
          <motion.div key="list" variants={containerVariants} initial="hidden" animate="visible" className="grid-cols-responsive-2">
            {filtered.map((contact) => (
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
                          {!contact.syncedAt && (
                            <span className="badge badge-pending">{t.unsyncedBadge}</span>
                          )}
                        </div>
                      </div>
                      <span className={`role-chip ${ROLE_CLASSES[contact.role]}`}>
                        {ROLE_LABELS[contact.role]}
                      </span>
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
