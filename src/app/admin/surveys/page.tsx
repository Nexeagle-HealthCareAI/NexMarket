'use client';

import React, { useEffect, useState } from 'react';
import { PencilIcon, TrashIcon, PlusIcon, FileDownIcon } from 'lucide-react';
import { useAgentStore } from '@/store/agent-store';
import { getAdminSurveys, type AdminSurveyDto, getAdminSurveyQuestions, createAdminSurveyQuestion, updateAdminSurveyQuestion, deleteAdminSurveyQuestion, deleteAdminSurveyResponse, updateAdminSurveyResponse, type SurveyQuestionDto, getPanchayats, type PanchayatDto } from '@/lib/sync/api-client';
import EditSurveyResponseModal from '@/components/admin/EditSurveyResponseModal';
import { HealthcareDashboard } from '@/components/admin/HealthcareDashboard';
import { HistoricalAnalyticsDashboard } from '@/components/admin/HistoricalAnalyticsDashboard';
import { motion, AnimatePresence } from 'framer-motion';
import { MultiSelectDropdown, PaginationControls } from './components/SharedComponents';
import { SurveyResponsesTab } from './components/SurveyResponsesTab';
import { SurveyDataManagementTab } from './components/SurveyDataManagementTab';
import { SurveyQuestionnaireTab } from './components/SurveyQuestionnaireTab';

const CONTACT_ROLE_LABELS: Record<string, string> = {
  asha_worker: 'ASHA Worker',
  rmp_doctor: 'RMP Doctor',
  ward_member: 'Ward Member',
  medicine_shop: 'Medicine Shop',
  mukhiya: 'Mukhiya',
  prominent_person: 'Prominent Person',
  lab: 'Lab/Pathology',
  nursing_home: 'Nursing Home',
  independent_doctor: 'Independent Doctor',
  hospital: 'Hospital',
  other: 'Other',
};

function contactRoleLabel(role?: string | null): string | null {
  if (!role) return null;
  return CONTACT_ROLE_LABELS[role] ?? role.replace(/_/g, ' ');
}

function panchayatLocationLabel(survey: AdminSurveyDto): string | null {
  if (!survey.locationName || survey.locationName === 'Unknown') return null;
  const parts = [survey.block, survey.district].filter(Boolean);
  return parts.length > 0 ? `${survey.locationName} (${parts.join(', ')})` : survey.locationName;
}

export default function AdminSurveysPage() {
  const agentId = useAgentStore((s) => s.agentId);
  const [activeTab, setActiveTab] = useState<'responses' | 'history' | 'data_management' | 'questionnaire' | 'insights'>('responses');

  // Responses State
  const [surveys, setSurveys] = useState<AdminSurveyDto[]>([]);
  const [allPanchayats, setAllPanchayats] = useState<PanchayatDto[]>([]);
  const [surveysLoading, setSurveysLoading] = useState(false);
  const [surveysError, setSurveysError] = useState<string | null>(null);

  // Filter States
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [selectedPanchayats, setSelectedPanchayats] = useState<string[]>([]);
  const [dateFilterMode, setDateFilterMode] = useState<'all' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Sort + Pagination — shared between Responses and Data Management, since
  // both tabs show the same underlying rows.
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // Questionnaire State
  const [questions, setQuestions] = useState<SurveyQuestionDto[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  
  // Editor State
  const [editingQuestion, setEditingQuestion] = useState<Partial<SurveyQuestionDto> | null>(null);
  const [editingResponse, setEditingResponse] = useState<AdminSurveyDto | null>(null);

  // Delete safety net — deleting a response is permanent (no undo, no trash),
  // so a plain confirm() was too easy to click through by habit. Requires
  // typing the exact contact name before the Delete button enables.
  const [deletingResponse, setDeletingResponse] = useState<AdminSurveyDto | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    setSurveysLoading(true);
    setQuestionsLoading(true);

    Promise.all([
      getAdminSurveys().catch(e => { if (!cancelled) setSurveysError(e.message); return []; }),
      getAdminSurveyQuestions().catch(e => { if (!cancelled) setQuestionsError(e.message); return []; }),
      getPanchayats().catch(() => [])
    ]).then(([sData, qData, pData]) => {
      if (!cancelled) {
        if (sData) setSurveys(sData as AdminSurveyDto[]);
        if (qData) setQuestions(qData as SurveyQuestionDto[]);
        if (pData) setAllPanchayats(pData as PanchayatDto[]);
        setSurveysLoading(false);
        setQuestionsLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [agentId]);

  // Any filter/sort/tab change invalidates the current page — jumping back
  // to page 1 avoids landing on a now-empty page.
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDistricts, selectedBlocks, selectedPanchayats, dateFilterMode, customStartDate, customEndDate, sortField, sortDirection, activeTab]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestion) return;
    
    const payload = {
      questionId: editingQuestion.questionId || '',
      text: editingQuestion.text || '',
      type: editingQuestion.type || 'single',
      optionsJson: editingQuestion.optionsJson ?? undefined,  // null → undefined to satisfy SurveyQuestionDto
      isOptional: editingQuestion.isOptional || false,
      isActive: editingQuestion.isActive ?? true,
      order: editingQuestion.order || 0
    };

    try {
      if (editingQuestion.id) {
        await updateAdminSurveyQuestion(editingQuestion.id, payload);
      } else {
        await createAdminSurveyQuestion(payload);
      }
      setEditingQuestion(null);
      
      // Refresh list
      const data = await getAdminSurveyQuestions();
      setQuestions(data);
    } catch (e: any) {
      alert(e.message || 'Failed to save question');
    }
  };

  const confirmDeleteResponse = async () => {
    if (!deletingResponse) return;
    const expected = (deletingResponse.contactName || '').trim().toLowerCase();
    if (!expected || deleteConfirmName.trim().toLowerCase() !== expected) {
      setDeleteError('Name does not match — type it exactly as shown to confirm.');
      return;
    }

    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteAdminSurveyResponse(deletingResponse.id);
      setSurveys(prev => prev.filter(r => r.id !== deletingResponse.id));
      setDeletingResponse(null);
      setDeleteConfirmName('');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete response');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUpdateResponse = async (id: string, newAnswersJson: string) => {
    try {
      const updated = await updateAdminSurveyResponse(id, newAnswersJson);
      setSurveys(prev => prev.map(r => r.id === id ? { ...r, answersJson: updated.answersJson } : r));
    } catch (err) {
      throw err;
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    if (!confirm('Are you sure you want to delete this question?')) return;
    try {
      await deleteAdminSurveyQuestion(id);
      setQuestions(q => q.filter(x => x.id !== id));
    } catch (e: any) {
      alert(e.message || 'Failed to delete question');
    }
  };

  if (!agentId) return <div style={{ padding: '2rem' }}>Not authenticated</div>;

  // Column list for the Responses table = every configured question, PLUS any
  // answer key that shows up in actual response data but has no matching
  // SurveyQuestionDto (e.g. responses submitted while the questionnaire had
  // zero questions configured — the agent app falls back to a hardcoded
  // legacy q1..q6 set in that case). Without this, those answers exist in the
  // data but never get a column to render under, and the table looks like it
  // only has Person Name / Added By / Date Added.
  const knownQuestionIds = new Set(questions.map(q => q.questionId));
  const orphanAnswerKeys = new Set<string>();
  surveys.forEach((s) => {
    try {
      Object.keys(JSON.parse(s.answersJson)).forEach((k) => {
        if (!knownQuestionIds.has(k)) orphanAnswerKeys.add(k);
      });
    } catch {}
  });
  const currentColumns: { questionId: string; text: string }[] = questions.map((q) => ({ questionId: q.questionId, text: q.text }));
  const historyColumns: { questionId: string; text: string }[] = [
    ...[...orphanAnswerKeys].sort().map((k) => ({ questionId: k, text: `(unconfigured: ${k})` })),
  ];
  
  const activeColumns = activeTab === 'history' ? historyColumns : currentColumns;

  // Compute unique regions for filters
  const uniqueDistricts = Array.from(new Set(allPanchayats.map(p => p.district))).sort();
  
  const filteredBlocks = allPanchayats
    .filter(p => selectedDistricts.length === 0 || selectedDistricts.includes(p.district))
    .map(p => p.block);
  const uniqueBlocks = Array.from(new Set(filteredBlocks)).sort();

  const filteredPanchayatList = allPanchayats
    .filter(p => (selectedDistricts.length === 0 || selectedDistricts.includes(p.district)) &&
                 (selectedBlocks.length === 0 || selectedBlocks.includes(p.block)));
  const uniquePanchayats = Array.from(new Set(filteredPanchayatList.map(p => p.id))).sort();

  // Apply filters
  const filteredSurveys = surveys.filter(survey => {
    const panchayat = allPanchayats.find(p => p.id === survey.panchayatId);
    if (panchayat) {
      if (selectedDistricts.length > 0 && !selectedDistricts.includes(panchayat.district)) return false;
      if (selectedBlocks.length > 0 && !selectedBlocks.includes(panchayat.block)) return false;
      if (selectedPanchayats.length > 0 && !selectedPanchayats.includes(panchayat.id)) return false;
    }
    // else: unknown panchayat — never excluded by the location filters (unchanged from before)

    if (dateFilterMode === 'custom') {
      const created = new Date(survey.createdAt);
      if (customStartDate && created < new Date(`${customStartDate}T00:00:00`)) return false;
      if (customEndDate && created > new Date(`${customEndDate}T23:59:59.999`)) return false;
    }

    return true;
  });

  // Apply sort — question columns sort by that question's answer text.
  const sortedSurveys = [...filteredSurveys].sort((a, b) => {
    if (!sortField) return 0;
    let aVal: string | number;
    let bVal: string | number;

    if (sortField === 'contactName') {
      aVal = (a.contactName || 'Unknown').toLowerCase();
      bVal = (b.contactName || 'Unknown').toLowerCase();
    } else if (sortField === 'agentName') {
      aVal = (a.agentName || a.agentId).toLowerCase();
      bVal = (b.agentName || b.agentId).toLowerCase();
    } else if (sortField === 'createdAt') {
      aVal = new Date(a.createdAt).getTime();
      bVal = new Date(b.createdAt).getTime();
    } else {
      let aAns: Record<string, unknown> = {};
      let bAns: Record<string, unknown> = {};
      try { aAns = JSON.parse(a.answersJson); } catch {}
      try { bAns = JSON.parse(b.answersJson); } catch {}
      aVal = String(aAns[sortField] ?? '').toLowerCase();
      bVal = String(bAns[sortField] ?? '').toLowerCase();
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Paginate — 10 per page, shared across both tabs.
  const totalPages = Math.max(1, Math.ceil(sortedSurveys.length / PAGE_SIZE));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginatedSurveys = sortedSurveys.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  // Insights — aggregated per-question breakdowns over the filtered (unpaginated)
  // response set, so admins see distributions for the whole filtered region/date
  // range rather than just the current page.
  const insightsByQuestion = questions
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((q) => {
      const raw: string[] = [];
      filteredSurveys.forEach((s) => {
        try {
          const parsed = JSON.parse(s.answersJson || '{}');
          const val = parsed[q.questionId];
          if (val === undefined || val === null || val === '') return;
          if (Array.isArray(val)) val.forEach((v) => raw.push(String(v)));
          else raw.push(String(val));
        } catch {}
      });
      return { question: q, raw, answeredCount: raw.length };
    });

  return (
    <div style={{ padding: '2rem', height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem', color: '#0f172a' }}>Surveys</h1>
          <p style={{ color: '#64748b' }}>Manage survey responses and the dynamic questionnaire</p>
        </div>
        {activeTab === 'questionnaire' && (
          <button 
            onClick={() => setEditingQuestion({ type: 'single', isOptional: false, isActive: true, order: questions.length + 1 })}
            style={{ background: '#4f46e5', color: 'white', padding: '0.6rem 1.2rem', borderRadius: '8px', fontWeight: 600, border: 'none', cursor: 'pointer' }}
          >
            + Add Question
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem', overflowX: 'auto', whiteSpace: 'nowrap', paddingBottom: '2px' }}>
        <button
          onClick={() => setActiveTab('responses')}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.5rem', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, color: activeTab === 'responses' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'responses' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s'
          }}
        >
          📊 Responses
        </button>
        <button
          onClick={() => setActiveTab('history')}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.5rem', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, color: activeTab === 'history' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'history' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s'
          }}
        >
          🕰️ History
        </button>
        <button
          onClick={() => setActiveTab('questionnaire')}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.5rem', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, color: activeTab === 'questionnaire' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'questionnaire' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s'
          }}
        >
          📋 Questionnaire
        </button>
        <button
          onClick={() => setActiveTab('data_management')}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.5rem', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, color: activeTab === 'data_management' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'data_management' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s'
          }}
        >
          🛠️ Data Management
        </button>
        <button
          onClick={() => setActiveTab('insights')}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.5rem', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, color: activeTab === 'insights' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'insights' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s'
          }}
        >
          💡 Insights
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {(activeTab === 'responses' || activeTab === 'history' || activeTab === 'data_management' || activeTab === 'insights') && (
          <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', background: 'white', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', flexShrink: 0 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Filter By Location:</span>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <MultiSelectDropdown
                label="District"
                options={uniqueDistricts.map(d => ({ value: d, label: d }))}
                selected={selectedDistricts}
                onChange={(val) => { setSelectedDistricts(val); setSelectedBlocks([]); setSelectedPanchayats([]); }}
                placeholder="All Districts"
              />
            </div>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <MultiSelectDropdown
                label="Block"
                options={uniqueBlocks.map(b => ({ value: b, label: b }))}
                selected={selectedBlocks}
                onChange={(val) => { setSelectedBlocks(val); setSelectedPanchayats([]); }}
                disabled={selectedDistricts.length === 0 && uniqueBlocks.length === 0}
                placeholder="All Blocks"
              />
            </div>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <MultiSelectDropdown
                label="Panchayat"
                options={uniquePanchayats.map(pId => {
                  const p = allPanchayats.find(x => x.id === pId);
                  return { value: pId, label: p ? `${p.name} (${p.district})` : pId };
                })}
                selected={selectedPanchayats}
                onChange={(val) => setSelectedPanchayats(val)}
                disabled={selectedBlocks.length === 0 && uniquePanchayats.length === 0}
                placeholder="All Panchayats"
              />
            </div>

            <div style={{ width: 1, alignSelf: 'stretch', background: '#e2e8f0' }} />

            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Date:</span>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Range</label>
              <select
                value={dateFilterMode}
                onChange={(e) => {
                  const mode = e.target.value as 'all' | 'custom';
                  setDateFilterMode(mode);
                  if (mode === 'all') { setCustomStartDate(''); setCustomEndDate(''); }
                }}
                style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontSize: '0.85rem', height: '38px' }}
              >
                <option value="all">All</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            {dateFilterMode === 'custom' && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>From</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.85rem', height: '38px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>To</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.85rem', height: '38px' }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* KPI — respects every active filter (district/block/panchayat/date),
            since it's just the length of the already-filtered response list
            the table itself renders from. */}
        {(activeTab === 'responses' || activeTab === 'history' || activeTab === 'data_management') && (
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', width: 'fit-content' }}>
            <div style={{ width: 44, height: 44, borderRadius: '10px', background: 'rgba(79,70,229,0.1)', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', flexShrink: 0 }}>
              📋
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Added</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>{surveysLoading ? '…' : filteredSurveys.length.toLocaleString()}</div>
            </div>
          </div>
        )}

        {(activeTab === 'responses' || activeTab === 'history') && (
          <div style={{ flex: 1, overflowY: 'auto', width: '100%', minWidth: 0 }}>
            {activeTab === 'history' && (
              <HistoricalAnalyticsDashboard surveys={filteredSurveys} orphanAnswerKeys={Array.from(orphanAnswerKeys)} />
            )}
            {questionsError && <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>⚠️ Question columns may be incomplete — failed to load the questionnaire: {questionsError}</p>}
            
            {surveysLoading && <p>Loading responses...</p>}
            {surveysError && <p style={{ color: 'red' }}>{surveysError}</p>}
            {!surveysLoading && !surveysError && sortedSurveys.length === 0 && <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>No responses match the selected filters.</p>}
            {!surveysLoading && sortedSurveys.length > 0 && (

              <SurveyResponsesTab
                surveysLoading={surveysLoading}
                surveysError={surveysError}
                sortedSurveys={sortedSurveys}
                activeColumns={activeColumns}
                sortField={sortField}
                sortDirection={sortDirection}
                handleSort={handleSort}
                paginatedSurveys={paginatedSurveys}
                pageSafe={pageSafe}
                totalPages={totalPages}
                setCurrentPage={setCurrentPage}
                PAGE_SIZE={PAGE_SIZE}
                contactRoleLabel={contactRoleLabel}
                panchayatLocationLabel={panchayatLocationLabel}
              />
            )}
          </div>
        )}

        {activeTab === 'questionnaire' && (
          <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, width: '100%' }}>
            {questionsLoading && <p>Loading questions...</p>}
            {questionsError && <p style={{ color: 'red' }}>{questionsError}</p>}
            {!questionsLoading && !questionsError && questions.length === 0 && <p>No questions defined. Add one!</p>}
            <SurveyQuestionnaireTab
              questionsLoading={questionsLoading}
              questionsError={questionsError}
              questions={questions}
              setEditingQuestion={setEditingQuestion}
              handleDeleteQuestion={handleDeleteQuestion}
            />
          </div>
        )}

        {activeTab === 'insights' && (
          <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, width: '100%', paddingBottom: '1rem' }}>
            <HealthcareDashboard />
          </div>
        )}

        {activeTab === 'data_management' && (
          <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, width: '100%' }}>
            {surveysLoading && <p>Loading responses...</p>}
            {surveysError && <p style={{ color: 'red' }}>{surveysError}</p>}
            {!surveysLoading && !surveysError && sortedSurveys.length === 0 && <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>No responses match the selected filters.</p>}
            <SurveyDataManagementTab
              surveysLoading={surveysLoading}
              surveysError={surveysError}
              sortedSurveys={sortedSurveys}
              historyColumns={historyColumns}
              sortField={sortField}
              sortDirection={sortDirection}
              handleSort={handleSort}
              paginatedSurveys={paginatedSurveys}
              pageSafe={pageSafe}
              totalPages={totalPages}
              setCurrentPage={setCurrentPage}
              PAGE_SIZE={PAGE_SIZE}
              contactRoleLabel={contactRoleLabel}
              panchayatLocationLabel={panchayatLocationLabel}
              setEditingResponse={setEditingResponse}
              setDeletingResponse={setDeletingResponse}
              setDeleteConfirmName={setDeleteConfirmName}
              setDeleteError={setDeleteError}
            />
          </div>
        )}
      </div>

      {/* Editor Modal */}
      <AnimatePresence>
        {editingQuestion && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingQuestion(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)' }} />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} style={{ position: 'relative', background: 'white', borderRadius: '16px', padding: '2rem', width: '100%', maxWidth: '500px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '1.5rem', color: '#0f172a' }}>
                {editingQuestion.id ? 'Edit Question' : 'Add Question'}
              </h2>
              <form onSubmit={handleSaveQuestion} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Question Key (ID)</label>
                  <input required value={editingQuestion.questionId || ''} onChange={e => setEditingQuestion({...editingQuestion, questionId: e.target.value})} placeholder="e.g. q1, current_party" style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }} />
                  <small style={{ color: '#64748b' }}>A unique identifier used for saving responses.</small>
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Question Text</label>
                  <input required value={editingQuestion.text || ''} onChange={e => setEditingQuestion({...editingQuestion, text: e.target.value})} placeholder="What is your favorite color?" style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }} />
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Type</label>
                    <select value={editingQuestion.type || 'single'} onChange={e => setEditingQuestion({...editingQuestion, type: e.target.value as any})} style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white' }}>
                      <option value="single">Single Choice (one answer)</option>
                      <option value="multi">Multiple Choice (many answers)</option>
                      <option value="text">Free Text Input</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Order</label>
                    <input type="number" required value={editingQuestion.order || 0} onChange={e => setEditingQuestion({...editingQuestion, order: parseInt(e.target.value) || 0})} style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }} />
                  </div>
                </div>

                {(editingQuestion.type === 'single' || editingQuestion.type === 'multi') && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Options (JSON Array)</label>
                    <textarea 
                      required 
                      value={editingQuestion.optionsJson || ''} 
                      onChange={e => setEditingQuestion({...editingQuestion, optionsJson: e.target.value})} 
                      placeholder='["Red", "Blue", "Green"]' 
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', minHeight: '80px', fontFamily: 'monospace' }} 
                    />
                    <small style={{ color: '#64748b' }}>Must be a valid JSON array of strings.</small>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editingQuestion.isOptional || false} onChange={e => setEditingQuestion({...editingQuestion, isOptional: e.target.checked})} />
                    Is Optional?
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editingQuestion.isActive ?? true} onChange={e => setEditingQuestion({...editingQuestion, isActive: e.target.checked})} />
                    Is Active?
                  </label>
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setEditingQuestion(null)} style={{ background: 'transparent', color: '#64748b', fontWeight: 700, border: 'none', cursor: 'pointer', padding: '0.75rem 1.5rem' }}>
                    Cancel
                  </button>
                  <button type="submit" style={{ background: '#4f46e5', color: 'white', fontWeight: 700, border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '0.75rem 1.5rem' }}>
                    Save Question
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <EditSurveyResponseModal
        response={editingResponse}
        questions={questions}
        isOpen={!!editingResponse}
        onClose={() => setEditingResponse(null)}
        onSave={handleUpdateResponse}
      />

      {/* Delete confirmation — type the person's name to unlock the button */}
      <AnimatePresence>
        {deletingResponse && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { if (!isDeleting) { setDeletingResponse(null); setDeleteConfirmName(''); setDeleteError(''); } }}
              style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)' }}
            />
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
              style={{ position: 'relative', background: 'white', borderRadius: '16px', padding: '2rem', width: '100%', maxWidth: '440px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}
            >
              <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.5rem', color: '#0f172a' }}>Delete this response?</h2>
              <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                This permanently removes the survey response for{' '}
                <strong style={{ color: '#0f172a' }}>{deletingResponse.contactName || 'Unknown'}</strong>. This cannot be undone.
              </p>

              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>
                Type <strong>{deletingResponse.contactName || 'Unknown'}</strong> to confirm
              </label>
              <input
                autoFocus
                value={deleteConfirmName}
                onChange={(e) => { setDeleteConfirmName(e.target.value); setDeleteError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmDeleteResponse(); }}
                placeholder={deletingResponse.contactName || 'Unknown'}
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.95rem', marginBottom: '0.5rem' }}
              />
              {deleteError && <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{deleteError}</p>}

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { setDeletingResponse(null); setDeleteConfirmName(''); setDeleteError(''); }}
                  disabled={isDeleting}
                  style={{ background: 'transparent', color: '#64748b', fontWeight: 700, border: 'none', cursor: isDeleting ? 'not-allowed' : 'pointer', padding: '0.75rem 1.5rem' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteResponse}
                  disabled={isDeleting || deleteConfirmName.trim().toLowerCase() !== (deletingResponse.contactName || '').trim().toLowerCase()}
                  style={{
                    background: deleteConfirmName.trim().toLowerCase() === (deletingResponse.contactName || '').trim().toLowerCase() ? '#b91c1c' : '#fca5a5',
                    color: 'white', fontWeight: 700, border: 'none', borderRadius: '8px',
                    cursor: (isDeleting || deleteConfirmName.trim().toLowerCase() !== (deletingResponse.contactName || '').trim().toLowerCase()) ? 'not-allowed' : 'pointer',
                    padding: '0.75rem 1.5rem'
                  }}
                >
                  {isDeleting ? 'Deleting...' : 'Delete Permanently'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

