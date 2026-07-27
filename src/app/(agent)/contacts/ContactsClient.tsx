'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAgentStore } from '@/store/agent-store';
import { useContacts, usePanchayats } from '@/lib/db';
import type { ContactRole } from '@/lib/db/schema';

const ROLE_LABELS: Record<ContactRole, string> = {
  asha_worker: 'ASHA',
  rmp_doctor: 'RMP Doctor',
  ward_member: 'Ward Member',
  medicine_shop: 'Medicine Shop',
};

const ROLE_CLASSES: Record<ContactRole, string> = {
  asha_worker: 'role-asha',
  rmp_doctor: 'role-rmp',
  ward_member: 'role-ward',
  medicine_shop: 'role-medicine',
};

export default function ContactsPage() {
  const agentId = useAgentStore((s) => s.agentId);
  const contacts = useContacts(agentId ?? undefined);
  const panchayats = usePanchayats();

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
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>Contacts</h1>
          <Link href="/contacts/new" className="btn btn-primary btn-sm" id="add-contact-btn">
            + Add
          </Link>
        </div>
      </div>

      {/* Search */}
      <div className="field-group" style={{ marginBottom: '0.75rem' }}>
        <input
          id="contact-search"
          className="field-input"
          type="search"
          placeholder="Search name, phone, panchayat…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Role filter chips */}
      <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
        {(['all', 'asha_worker', 'rmp_doctor', 'ward_member', 'medicine_shop'] as const).map((role) => (
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
            {role === 'all' ? 'All' : ROLE_LABELS[role]}
          </button>
        ))}
      </div>

      {/* Count */}
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👤</div>
          <h3>No contacts yet</h3>
          <p style={{ fontSize: '0.85rem' }}>Add contacts from the panchayats you visit</p>
          <Link href="/contacts/new" className="btn btn-primary btn-sm" style={{ marginTop: '0.5rem' }}>
            Add First Contact
          </Link>
        </div>
      ) : (
        <div className="grid-cols-responsive-2">
          {filtered.map((contact) => (
            <Link
              key={contact.clientId}
              href={`/contacts/${contact.clientId}`}
              id={`contact-${contact.clientId}`}
              style={{ textDecoration: 'none' }}
            >
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                        {contact.name}
                      </p>
                      {contact.potentialDuplicateOf?.length ? (
                        <span className="badge badge-dup">⚠ Dup</span>
                      ) : null}
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      📍 {panchayatMap.get(contact.panchayatId) ?? 'Unknown panchayat'}
                    </p>
                    {contact.phone && (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                        📞 {contact.phone}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      {contact.whatsappAdded && (
                        <span className="badge" style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--color-success)' }}>WhatsApp ✓</span>
                      )}
                      {contact.cardGiven && (
                        <span className="badge" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--color-primary-600)' }}>Card ✓</span>
                      )}
                      {!contact.syncedAt && (
                        <span className="badge badge-pending">Unsynced</span>
                      )}
                    </div>
                  </div>
                  <span className={`role-chip ${ROLE_CLASSES[contact.role]}`}>
                    {ROLE_LABELS[contact.role]}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
