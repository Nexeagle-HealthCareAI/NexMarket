'use client';

import React from 'react';
import { type AdminSurveyDto } from '@/lib/sync/api-client';
import { SortableTh, PaginationControls } from './SharedComponents';

interface SurveyDataManagementTabProps {
  surveysLoading: boolean;
  surveysError: string | null;
  sortedSurveys: AdminSurveyDto[];
  historyColumns: { questionId: string; text: string }[];
  sortField: string | null;
  sortDirection: 'asc' | 'desc';
  handleSort: (field: string) => void;
  paginatedSurveys: AdminSurveyDto[];
  pageSafe: number;
  totalPages: number;
  setCurrentPage: (page: number) => void;
  PAGE_SIZE: number;
  contactRoleLabel: (role?: string | null) => string | null;
  panchayatLocationLabel: (survey: AdminSurveyDto) => string | null;
  setEditingResponse: (survey: AdminSurveyDto) => void;
  setDeletingResponse: (survey: AdminSurveyDto) => void;
  setDeleteConfirmName: (name: string) => void;
  setDeleteError: (error: string) => void;
}

export function SurveyDataManagementTab({
  surveysLoading, surveysError, sortedSurveys, historyColumns,
  sortField, sortDirection, handleSort, paginatedSurveys,
  pageSafe, totalPages, setCurrentPage, PAGE_SIZE,
  contactRoleLabel, panchayatLocationLabel,
  setEditingResponse, setDeletingResponse, setDeleteConfirmName, setDeleteError
}: SurveyDataManagementTabProps) {
  
  if (surveysLoading) return <p>Loading responses...</p>;
  if (surveysError) return <p style={{ color: 'red' }}>{surveysError}</p>;
  if (sortedSurveys.length === 0) return <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>No responses match the selected filters.</p>;

  return (
    <>
      <style>{`
        .survey-manage-table-desktop { display: table; }
        .survey-manage-cards-mobile { display: none; }
        @media (max-width: 768px) {
          .survey-manage-table-desktop { display: none; }
          .survey-manage-cards-mobile { display: flex; flex-direction: column; gap: 1rem; padding: 1rem; }
        }
      `}</style>
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', overflow: 'hidden', maxWidth: '100%' }}>
        
        {/* DESKTOP TABLE */}
        <div style={{ overflowX: 'auto', maxWidth: '100%' }} className="survey-manage-table-desktop">
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
            <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <tr>
                <SortableTh label="Person Name" field="contactName" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableTh label="Added By" field="agentName" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                {historyColumns.map(q => (
                  <SortableTh key={q.questionId} label={q.text} field={q.questionId} sortField={sortField} sortDirection={sortDirection} onSort={handleSort} style={{ minWidth: '150px' }} />
                ))}
                <SortableTh label="Date Added" field="createdAt" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <th style={{ padding: '1rem', fontWeight: 700, color: '#334155', minWidth: '160px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedSurveys.map((survey) => {
                let answers: any = {};
                try {
                  if (survey.answersJson) answers = JSON.parse(survey.answersJson);
                } catch (e) {}

                return (
                  <tr key={survey.id} style={{ borderBottom: '1px solid #e2e8f0', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{survey.contactName || 'Unknown'}</div>
                      {contactRoleLabel(survey.contactRole) && (
                        <div style={{ marginTop: '0.2rem' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#4f46e5', background: '#eef2ff', padding: '0.1rem 0.45rem', borderRadius: '10px' }}>
                            {contactRoleLabel(survey.contactRole)}
                          </span>
                        </div>
                      )}
                      {panchayatLocationLabel(survey) && (
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>
                          📍 {panchayatLocationLabel(survey)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '1rem', color: '#334155' }}>{survey.agentName || survey.agentId}</td>
                    {historyColumns.map((q) => {
                      const ans = answers[q.questionId];
                      const hasAnswer = ans !== undefined && ans !== null && ans !== '';
                      return (
                        <td key={q.questionId} style={{ padding: '1rem', color: '#334155' }}>
                          {hasAnswer ? (
                            <span style={{ background: '#f1f5f9', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 500, display: 'inline-block' }}>
                              {String(ans)}
                            </span>
                          ) : (
                            <span style={{ color: '#cbd5e1', fontSize: '0.85rem', fontStyle: 'italic' }}>No answer</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ padding: '1rem', color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(survey.createdAt).toLocaleDateString('en-GB')}</td>
                    <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>
                      <button onClick={() => setEditingResponse(survey)} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', marginRight: '0.5rem', fontSize: '0.8rem', transition: 'all 0.2s' }}>Edit</button>
                      <button onClick={() => { setDeletingResponse(survey); setDeleteConfirmName(''); setDeleteError(''); }} style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', transition: 'all 0.2s' }}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* MOBILE CARDS */}
        <div className="survey-manage-cards-mobile" style={{ background: '#f8fafc' }}>
          {paginatedSurveys.map((survey) => {
            let answers: Record<string, unknown> = {};
            try { answers = JSON.parse(survey.answersJson); } catch {}

            return (
              <div key={survey.id} style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <div>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '1.1rem' }}>{survey.contactName || 'Unknown'}</div>
                    {contactRoleLabel(survey.contactRole) && (
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#4f46e5', marginTop: '0.2rem' }}>
                        {contactRoleLabel(survey.contactRole)}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'right', fontWeight: 600 }}>
                    {new Date(survey.createdAt).toLocaleDateString('en-GB')}
                  </div>
                </div>

                {panchayatLocationLabel(survey) && (
                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    📍 <span>{panchayatLocationLabel(survey)}</span>
                  </div>
                )}

                <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  👤 <span>Added by: <strong style={{ color: '#0f172a' }}>{survey.agentName || survey.agentId}</strong></span>
                </div>

                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Survey Responses</div>
                  {historyColumns.map((q, i) => {
                    const ans = answers[q.questionId];
                    const hasAnswer = ans !== undefined && ans !== null && ans !== '';
                    return (
                      <div key={q.questionId}>
                        <div style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 600, marginBottom: '0.25rem' }}>Q{i + 1}: {q.text}</div>
                        {hasAnswer ? (
                          <div style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: 500 }}>{String(ans)}</div>
                        ) : (
                          <div style={{ fontSize: '0.85rem', color: '#cbd5e1', fontStyle: 'italic' }}>No answer provided</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                  <button onClick={() => setEditingResponse(survey)} style={{ flex: 1, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', padding: '0.75rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}>
                    ✏️ Edit
                  </button>
                  <button onClick={() => { setDeletingResponse(survey); setDeleteConfirmName(''); setDeleteError(''); }} style={{ flex: 1, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '0.75rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}>
                    🗑️ Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <PaginationControls currentPage={pageSafe} totalPages={totalPages} totalItems={sortedSurveys.length} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} />
      </div>
    </>
  );
}
