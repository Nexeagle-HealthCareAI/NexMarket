import React from 'react';
import Link from 'next/link';
import { Pin } from 'lucide-react';
import type { AdminContactDto } from '@/lib/sync/api-client';

export interface ContactRowProps {
  contact: AdminContactDto;
  isPinned?: boolean;
  onTogglePin?: () => void;
  panchayatName?: string;
  blockName?: string;
  showStageAndFollowUp: boolean;
  showComments: boolean;
  onEdit: () => void;
  onViewHistory: () => void;
  onLogCall?: (reason: string) => void;
  showQuickActions?: boolean;
  onDelete?: () => void;
}

export function ContactRow({ 
  contact, 
  isPinned, 
  onTogglePin, 
  panchayatName, 
  blockName, 
  showStageAndFollowUp, 
  showComments, 
  onEdit, 
  onViewHistory, 
  onLogCall, 
  showQuickActions, 
  onDelete 
}: ContactRowProps) {
  const lastUpdatedTime = contact.lastUpdatedAt
    ? new Date(contact.lastUpdatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }) + ' IST'
    : 'Never';
  const lastUpdatedBy = contact.lastUpdatedBy || 'N/A';

  const gapDays = contact.lastUpdatedAt 
    ? Math.floor((new Date().getTime() - new Date(contact.lastUpdatedAt).getTime()) / (1000 * 3600 * 24))
    : null;

  const statusColor = contact.status === 'Lead' ? '#94a3b8' :
                      contact.status === 'Contacted' ? '#eab308' :
                      contact.status === 'FollowUp' ? '#3b82f6' :
                      contact.status === 'Converted' ? '#22c55e' : '#ef4444';

  return (
    <tr style={{ borderBottom: '1px solid #e2e8f0', background: 'white', transition: 'background 0.2s' }}>
      <td data-label="Contact Details" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {contact.photoUrl ? (
              <img src={contact.photoUrl} alt={contact.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontWeight: 700, color: '#64748b', fontSize: '1.2rem' }}>{contact.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>{contact.name}</div>
              {onTogglePin && (
                <button 
                  onClick={onTogglePin} 
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: isPinned ? '#4f46e5' : '#cbd5e1', display: 'flex', alignItems: 'center', padding: '0.1rem' }}
                  title={isPinned ? 'Unpin' : 'Pin to top'}
                >
                  {isPinned ? <Pin size={16} fill="currentColor" /> : <Pin size={16} />}
                </button>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'capitalize', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span>{contact.role.replace('_', ' ')}</span>
              {contact.phone && (
                <>
                  <span style={{ color: '#cbd5e1' }}>•</span>
                  <span style={{ color: '#4f46e5' }}>{contact.phone}</span>
                </>
              )}
            </div>
            {contact.agentEscalated && (
              <div style={{ marginTop: '0.35rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                  🚨 ESCALATED
                </span>
                {contact.agentEscalationNote && (
                  <div style={{ fontSize: '0.75rem', color: '#991b1b', marginTop: '0.25rem', background: '#fef2f2', padding: '0.35rem 0.5rem', borderRadius: '4px', borderLeft: '3px solid #ef4444' }}>
                    {contact.agentEscalationNote}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
      <td data-label="Location (Village)" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 600, color: '#334155', fontSize: '0.85rem' }}>{panchayatName || '-'}</div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>{blockName || '-'} Block</div>
        {contact.latitude && contact.longitude && (
          <a
            href={`https://www.google.com/maps?q=${contact.latitude},${contact.longitude}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
              fontSize: '0.7rem', fontWeight: 600, color: '#059669',
              textDecoration: 'none', background: '#d1fae5', padding: '0.15rem 0.4rem', borderRadius: '4px'
            }}
          >
            📍 Map
          </a>
        )}
      </td>
      {showStageAndFollowUp && (
        <>
          <td data-label="Stage (Result)" style={{ padding: '1rem' }}>
            <span style={{ 
              background: `${statusColor}20`, color: statusColor, 
              padding: '0.25rem 0.75rem', borderRadius: '20px', fontWeight: 700, fontSize: '0.8rem' 
            }}>
              {contact.status}
            </span>
          </td>
          <td data-label="Follow-up Date" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 600 }}>
              {contact.followUpDate ? new Date(contact.followUpDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
            </div>
          </td>
        </>
      )}
      <td data-label="Added By" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 600, color: '#334155', fontSize: '0.85rem' }}>{contact.agentName || contact.agentId || 'Agent'}</div>
        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(contact.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      </td>
      {showComments && (
        <>
          <td data-label="Comments" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#475569', maxWidth: '250px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={contact.comments || ''}>
              {contact.comments || '-'}
            </div>
          </td>
          <td data-label="Issues" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#ef4444', maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={contact.complaints || ''}>
              {contact.complaints || '-'}
            </div>
          </td>
          <td data-label="Conflicts" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#f97316', maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={contact.conflicts || ''}>
              {contact.conflicts || '-'}
            </div>
          </td>
        </>
      )}
      <td data-label="Last Updated" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>{lastUpdatedTime}</div>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>By {lastUpdatedBy}</div>
            {gapDays !== null && (
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: gapDays > 7 ? '#ef4444' : gapDays > 3 ? '#f59e0b' : '#10b981', marginTop: '0.25rem', background: gapDays > 7 ? '#fef2f2' : gapDays > 3 ? '#fffbeb' : '#ecfdf5', padding: '0.1rem 0.3rem', borderRadius: '4px', display: 'inline-block' }}>
                {gapDays === 0 ? 'Updated today' : `${gapDays} days ago`}
              </div>
            )}
          </div>
          <button onClick={onViewHistory} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, color: '#4f46e5', transition: 'background 0.2s' }}>
            History
          </button>
        </div>
      </td>
      <td data-label="Actions" style={{ padding: '1rem', textAlign: 'center', minWidth: '220px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onEdit} style={{ background: 'transparent', color: '#0f172a', border: '1px solid #e2e8f0', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              Update
            </button>
            <Link href={`/admin/pipeline/${contact.clientId}`} style={{ background: '#0f172a', color: 'white', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
              Profile
            </Link>
            {onDelete && (
              <button onClick={onDelete} style={{ background: 'transparent', color: '#ef4444', border: '1px solid #fecaca', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                Delete
              </button>
            )}
          </div>
          {showQuickActions && onLogCall && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.5rem', width: '100%', background: '#f8fafc', padding: '0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', textAlign: 'center' }}>Log Unanswered Call</span>
              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button onClick={() => onLogCall('No Answer')} title="Push follow-up to tomorrow" style={{ background: 'white', border: '1px solid #cbd5e1', padding: '0.25rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>No Answer</button>
                <button onClick={() => onLogCall('Busy')} title="Push follow-up to tomorrow" style={{ background: 'white', border: '1px solid #cbd5e1', padding: '0.25rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>Busy</button>
                <button onClick={() => onLogCall('Switched Off')} title="Push follow-up to tomorrow" style={{ background: 'white', border: '1px solid #cbd5e1', padding: '0.25rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>Off</button>
                <button onClick={() => onLogCall('Invalid Number')} title="Remove follow-up date" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '0.25rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'} onMouseLeave={e => e.currentTarget.style.background = '#fef2f2'}>Invalid</button>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
