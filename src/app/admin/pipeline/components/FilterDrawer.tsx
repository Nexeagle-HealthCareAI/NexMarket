import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FilterIcon } from 'lucide-react';

export function MultiSelectDropdown({ 
  label, 
  options, 
  selected, 
  onChange, 
  placeholder, 
  disabled 
}: { 
  label: string, 
  options: string[], 
  selected: string[], 
  onChange: (selected: string[]) => void, 
  placeholder: string, 
  disabled?: boolean 
}) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleSelection = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((o: string) => o !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      
      <div style={{ position: 'relative' }}>
        {isOpen && (
          <div 
            style={{ position: 'fixed', inset: 0, zIndex: 40 }} 
            onClick={() => setIsOpen(false)} 
          />
        )}
        
        <div 
          onClick={() => !disabled && setIsOpen(!isOpen)}
          style={{ 
            width: '100%', padding: '0.75rem', borderRadius: '8px', 
            border: '1px solid #cbd5e1', background: disabled ? '#f1f5f9' : 'white', 
            fontWeight: 600, color: '#0f172a', cursor: disabled ? 'not-allowed' : 'pointer', 
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            position: 'relative', zIndex: 41
          }}
        >
          <span style={{ fontSize: '0.85rem', color: selected.length === 0 ? '#64748b' : '#0f172a' }}>
            {selected.length === 0 ? placeholder : `${selected.length} Selected`}
          </span>
          <span style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', fontSize: '0.8rem' }}>▼</span>
        </div>
        
        <AnimatePresence>
          {isOpen && !disabled && (
            <motion.div 
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              style={{ 
                position: 'absolute', top: '100%', left: 0, right: 0, 
                background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', 
                marginTop: '0.5rem', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)', 
                zIndex: 50, maxHeight: '250px', overflowY: 'auto' 
              }}
            >
              {options.length === 0 ? (
                <div style={{ padding: '0.75rem', color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center' }}>No options</div>
              ) : (
                <div style={{ padding: '0.5rem' }}>
                  {options.map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', cursor: 'pointer', borderRadius: '4px' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <input 
                        type="checkbox" 
                        checked={selected.includes(opt)}
                        onChange={(e) => {
                          if (e.target.checked) onChange([...selected, opt]);
                          else onChange(selected.filter(s => s !== opt));
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 500 }}>{opt}</span>
                    </label>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export interface FilterDrawerProps {
  dateFilter: 'all' | 'today' | 'yesterday' | 'custom';
  setDateFilter: (v: 'all' | 'today' | 'yesterday' | 'custom') => void;
  customStartDate: string;
  setCustomStartDate: (v: string) => void;
  customEndDate: string;
  setCustomEndDate: (v: string) => void;
  selectedCities: string[];
  setSelectedCities: (v: string[]) => void;
  uniqueCities: string[];
  selectedBlocks: string[];
  setSelectedBlocks: (v: string[]) => void;
  uniqueBlocks: string[];
  selectedPanchayats: string[];
  setSelectedPanchayats: (v: string[]) => void;
  uniquePanchayats: string[];
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  showEscalatedOnly: boolean;
  setShowEscalatedOnly: (v: boolean) => void;
  setPage: (p: number) => void;
}

export function FilterDrawer({
  dateFilter, setDateFilter,
  customStartDate, setCustomStartDate,
  customEndDate, setCustomEndDate,
  selectedCities, setSelectedCities, uniqueCities,
  selectedBlocks, setSelectedBlocks, uniqueBlocks,
  selectedPanchayats, setSelectedPanchayats, uniquePanchayats,
  searchQuery, setSearchQuery,
  showEscalatedOnly, setShowEscalatedOnly,
  setPage
}: FilterDrawerProps) {
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

  return (
    <>
      {/* Mobile Filter Toggle */}
      <div className="mobile-only" style={{ marginBottom: '1rem', display: 'none' }}>
        <button
          onClick={() => setIsFilterDrawerOpen(!isFilterDrawerOpen)}
          style={{ width: '100%', padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: 600, color: '#334155' }}
        >
          <FilterIcon size={16} />
          {isFilterDrawerOpen ? 'Hide Filters' : 'Show Filters'}
        </button>
      </div>

      {/* Filters Section */}
      <div className={`filters-container ${isFilterDrawerOpen ? 'open' : ''}`} style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap', zIndex: 20, position: 'relative' }}>
        <div style={{ flex: 1, minWidth: '180px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date Filter</label>
          <select 
            value={dateFilter} 
            onChange={(e) => { setDateFilter(e.target.value as 'all' | 'today' | 'yesterday' | 'custom'); setPage(1); }}
            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', fontWeight: 600, color: '#0f172a', outline: 'none' }}
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>
        
        {dateFilter === 'custom' && (
          <>
            <div style={{ minWidth: '130px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Start Date</label>
              <input type="date" value={customStartDate} onChange={e => { setCustomStartDate(e.target.value); setPage(1); }} style={{ width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, color: '#0f172a' }} />
            </div>
            <div style={{ minWidth: '130px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>End Date</label>
              <input type="date" value={customEndDate} onChange={e => { setCustomEndDate(e.target.value); setPage(1); }} style={{ width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, color: '#0f172a' }} />
            </div>
          </>
        )}

        <div style={{ flex: 1, minWidth: '180px' }}>
          <MultiSelectDropdown
            label="City (District)"
            placeholder="All Cities"
            options={uniqueCities}
            selected={selectedCities}
            onChange={(val) => { setSelectedCities(val); setSelectedBlocks([]); setSelectedPanchayats([]); setPage(1); }}
          />
        </div>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Search</label>
          <input
            type="search"
            placeholder="Name or Phone..."
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
            style={{ width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, color: '#0f172a' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <MultiSelectDropdown
            label="Block"
            placeholder="All Blocks"
            options={uniqueBlocks}
            selected={selectedBlocks}
            onChange={(val) => { setSelectedBlocks(val); setSelectedPanchayats([]); setPage(1); }}
            disabled={selectedCities.length === 0 && uniqueBlocks.length === 0}
          />
        </div>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <MultiSelectDropdown
            label="Panchayat"
            placeholder="All Panchayats"
            options={uniquePanchayats}
            selected={selectedPanchayats}
            onChange={(val) => { setSelectedPanchayats(val); setPage(1); }}
            disabled={selectedBlocks.length === 0 && uniquePanchayats.length === 0}
          />
        </div>
        
        {/* Escalation Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: showEscalatedOnly ? '#fef2f2' : 'white', border: `1px solid ${showEscalatedOnly ? '#fca5a5' : '#cbd5e1'}`, padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s', marginTop: 'auto' }} onClick={() => { setShowEscalatedOnly(!showEscalatedOnly); setPage(1); }}>
          <div style={{ width: 40, height: 22, background: showEscalatedOnly ? '#ef4444' : '#cbd5e1', borderRadius: 11, position: 'relative', transition: 'background 0.2s' }}>
            <div style={{ position: 'absolute', top: 2, left: showEscalatedOnly ? 20 : 2, width: 18, height: 18, background: 'white', borderRadius: '50%', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }} />
          </div>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: showEscalatedOnly ? '#b91c1c' : '#475569' }}>
            🚨 Escalations Only
          </span>
        </div>
      </div>
    </>
  );
}
