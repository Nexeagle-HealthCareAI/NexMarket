import React, { useState } from 'react';
import Link from 'next/link';
import type { AdminContactDto, PanchayatDto } from '@/lib/sync/api-client';

export interface KanbanBoardProps {
  contacts: AdminContactDto[];
  panchayatsData: PanchayatDto[];
  saveContactMutation: { mutate: (args: { clientId: string, update: any }) => void };
  setEditDrawerContact: (contact: AdminContactDto) => void;
}

export function KanbanBoard({ contacts, panchayatsData, saveContactMutation, setEditDrawerContact }: KanbanBoardProps) {
  const [draggedContactId, setDraggedContactId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, contactId: string) => {
    e.dataTransfer.setData('text/plain', contactId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedContactId(contactId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    const contactId = e.dataTransfer.getData('text/plain');
    setDraggedContactId(null);
    
    const contact = contacts.find(c => c.clientId === contactId);
    if (!contact) return;

    if (newStatus === 'Escalated') {
      if (contact.agentEscalated) return;
      saveContactMutation.mutate({ clientId: contactId, update: { agentEscalated: true } });
    } else {
      if (contact.status === newStatus && !contact.agentEscalated) return;
      saveContactMutation.mutate({ clientId: contactId, update: { status: newStatus, agentEscalated: false } });
    }
  };

  const handleStatusChange = (contactId: string, newStatus: string) => {
    if (newStatus === 'Escalated') {
      saveContactMutation.mutate({ clientId: contactId, update: { agentEscalated: true } });
    } else {
      saveContactMutation.mutate({ clientId: contactId, update: { status: newStatus, agentEscalated: false } });
    }
  };

  const columns = [
    { id: 'Lead', title: 'Leads', color: '#94a3b8' },
    { id: 'Contacted', title: 'Contacted', color: '#eab308' },
    { id: 'FollowUp', title: 'Follow-Up', color: '#3b82f6' },
    { id: 'Escalated', title: 'Escalated', color: '#ef4444' }
  ];

  return (
    <>
      <style>{`
        .kanban-board {
          display: flex;
          gap: 1.5rem;
          flex: 1;
          overflow-x: auto;
          padding: 1rem;
          background: #f8fafc;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          min-height: 600px;
          scroll-snap-type: x mandatory;
          scroll-padding: 1rem;
          /* Hide scrollbar for cleaner look on mobile */
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
        }
        .kanban-board::-webkit-scrollbar {
          display: none;
        }
        .kanban-col {
          flex: 0 0 320px;
          display: flex;
          flex-direction: column;
          background: #f1f5f9;
          border-radius: 12px;
          height: 100%;
          border: 1px solid #e2e8f0;
          scroll-snap-align: center;
        }
        @media (max-width: 768px) {
          .kanban-board {
            padding: 0.5rem;
            gap: 1rem;
            scroll-padding: 0.5rem;
          }
          .kanban-col {
            flex: 0 0 calc(100vw - 3rem);
          }
        }
      `}</style>
      <div className="kanban-board">
        {columns.map(col => {
          const colContacts = contacts.filter(c => col.id === 'Escalated' ? c.agentEscalated : (c.status === col.id && !c.agentEscalated));
          return (
          <div 
            key={col.id} 
            className="kanban-col"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            <div style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: col.color }} />
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#1e293b' }}>{col.title}</h3>
            </div>
            <span style={{ background: '#e2e8f0', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '12px' }}>
              {colContacts.length}
            </span>
          </div>
          <div style={{ padding: '0.75rem', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {colContacts.map(c => (
              <KanbanCard 
                key={c.clientId} 
                contact={c} 
                panchayatsData={panchayatsData}
                isDragging={draggedContactId === c.clientId}
                onDragStart={(e: React.DragEvent) => handleDragStart(e, c.clientId)}
                onDragEnd={() => setDraggedContactId(null)}
                onEdit={() => setEditDrawerContact(c)}
                onStatusChange={handleStatusChange}
              />
            ))}
            {colContacts.length === 0 && (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600, border: '2px dashed #cbd5e1', borderRadius: '8px' }}>
                Drop contacts here
              </div>
            )}
          </div>
        </div>
        );
      })}
      </div>
    </>
  );
}

function KanbanCard({ 
  contact, 
  panchayatsData, 
  isDragging, 
  onDragStart, 
  onDragEnd, 
  onEdit, 
  onStatusChange 
}: {
  contact: AdminContactDto;
  panchayatsData: PanchayatDto[];
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onEdit: () => void;
  onStatusChange: (id: string, s: string) => void;
}) {
  const pInfo = panchayatsData.find((p: PanchayatDto) => p.id === contact.panchayatId);
  const isEscalated = contact.agentEscalated;
  
  return (
    <div 
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{ 
        background: 'white', 
        borderRadius: '8px', 
        padding: '1rem', 
        boxShadow: isDragging ? '0 8px 16px rgba(0,0,0,0.1)' : '0 1px 3px rgba(0,0,0,0.1)', 
        border: '1px solid #e2e8f0',
        borderLeft: isEscalated ? '4px solid #ef4444' : '1px solid #e2e8f0',
        cursor: 'grab',
        opacity: isDragging ? 0.5 : 1,
        transition: 'box-shadow 0.2s',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>{contact.name}</h4>
          <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'capitalize' }}>{contact.role.replace('_', ' ')}</span>
        </div>
        {contact.photoUrl ? (
          <img src={contact.photoUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8' }}>
            {contact.name.charAt(0)}
          </div>
        )}
      </div>

      <div style={{ fontSize: '0.8rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>📞</span> {contact.phone || 'No Phone'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>📍</span> {pInfo ? pInfo.name : 'Unknown Village'}
        </div>
      </div>

      {contact.followUpDate && (
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#f8fafc', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #e2e8f0', width: 'fit-content' }}>
          🗓️ Due: {new Date(contact.followUpDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </div>
      )}

      {isEscalated && (
        <div style={{ fontSize: '0.7rem', color: '#b91c1c', background: '#fef2f2', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #fecaca' }}>
          🚨 {contact.agentEscalationNote || 'Escalated'}
        </div>
      )}

      {/* MOBILE ONLY QUICK ACTIONS */}
      <style>{`
        .kanban-mobile-actions { display: none; }
        @media (max-width: 768px) {
          .kanban-mobile-actions { display: flex; }
        }
      `}</style>
      {onStatusChange && (
        <div className="kanban-mobile-actions" style={{ gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ width: '100%', fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Move to:</span>
          {(contact.agentEscalated || contact.status !== 'Lead') && (
            <button onClick={() => onStatusChange(contact.clientId, 'Lead')} style={{ flex: 1, padding: '0.35rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}>Lead</button>
          )}
          {(contact.agentEscalated || contact.status !== 'Contacted') && (
            <button onClick={() => onStatusChange(contact.clientId, 'Contacted')} style={{ flex: 1, padding: '0.35rem', background: '#fef9c3', border: '1px solid #fde047', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600, color: '#854d0e', cursor: 'pointer' }}>Contacted</button>
          )}
          {(contact.agentEscalated || contact.status !== 'FollowUp') && (
            <button onClick={() => onStatusChange(contact.clientId, 'FollowUp')} style={{ flex: 1, padding: '0.35rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600, color: '#1d4ed8', cursor: 'pointer' }}>Follow-Up</button>
          )}
          {!contact.agentEscalated && (
            <button onClick={() => onStatusChange(contact.clientId, 'Escalated')} style={{ flex: 1, padding: '0.35rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600, color: '#b91c1c', cursor: 'pointer' }}>Escalate</button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
        <button onClick={onEdit} style={{ flex: 1, padding: '0.35rem', background: 'transparent', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, color: '#334155', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          Edit
        </button>
        <Link href={`/admin/pipeline/${contact.clientId}`} style={{ flex: 1, padding: '0.35rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, color: '#0f172a', textAlign: 'center', textDecoration: 'none', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'} onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}>
          Profile
        </Link>
      </div>
    </div>
  );
}
