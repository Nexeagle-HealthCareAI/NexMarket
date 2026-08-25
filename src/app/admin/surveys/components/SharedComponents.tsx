'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Sortable column header
export interface SortableThProps {
  label: React.ReactNode;
  field: string;
  sortField: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (field: string) => void;
  style?: React.CSSProperties;
  title?: string;
}

export function SortableTh({ label, field, sortField, sortDirection, onSort, style, title }: SortableThProps) {
  const isActive = sortField === field;
  return (
    <th
      onClick={() => onSort(field)}
      title={title}
      style={{ padding: '1rem', fontWeight: 700, color: isActive ? '#4f46e5' : '#334155', cursor: 'pointer', userSelect: 'none', ...style }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
        {label}
        <span style={{ fontSize: '0.7rem', opacity: isActive ? 1 : 0.35 }}>
          {isActive ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  );
}

// Pagination controls
export interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function PaginationControls({ currentPage, totalPages, totalItems, pageSize, onPageChange }: PaginationControlsProps) {
  if (totalItems === 0) return null;
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', borderTop: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '0.75rem' }}>
      <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
        Showing {startItem}–{endItem} of {totalItems}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'white', color: currentPage <= 1 ? '#cbd5e1' : '#334155', fontWeight: 600, cursor: currentPage <= 1 ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
        >
          Prev
        </button>
        <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 600, padding: '0 0.5rem' }}>
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'white', color: currentPage >= totalPages ? '#cbd5e1' : '#334155', fontWeight: 600, cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// MultiSelect Dropdown Component
export interface MultiSelectDropdownProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function MultiSelectDropdown({ label, options, selected, onChange, disabled, placeholder }: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const toggleSelection = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((o: string) => o !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  return (
    <div style={{ position: 'relative', opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>{label}</label>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ 
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
          background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', 
          padding: '0.5rem 1rem', width: '220px', cursor: 'pointer', 
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
          <span style={{ fontSize: '0.85rem', color: selected.length === 0 ? '#64748b' : '#0f172a' }}>
            {selected.length === 0 ? (placeholder || 'Select...') : `${selected.length} Selected`}
          </span>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            style={{ 
              position: 'absolute', top: '100%', left: 0, marginTop: '0.25rem', width: '250px', 
              background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', 
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', zIndex: 50,
              maxHeight: '300px', overflowY: 'auto'
            }}
          >
            <div style={{ position: 'fixed', inset: 0, zIndex: -1 }} onClick={() => setIsOpen(false)} />
            
            <div style={{ padding: '0.5rem' }}>
              {options.length === 0 ? (
                <div style={{ padding: '0.5rem', color: '#64748b', fontSize: '0.85rem', textAlign: 'center' }}>No options available</div>
              ) : (
                options.map(opt => (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', cursor: 'pointer', borderRadius: '4px', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <input 
                      type="checkbox" 
                      checked={selected.includes(opt.value)}
                      onChange={() => toggleSelection(opt.value)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: selected.includes(opt.value) ? 600 : 400 }}>{opt.label}</span>
                  </label>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
