'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZES = [10, 25, 50, 100];

/**
 * Splits a list into pages for a table. Goes back to page 1 whenever `resetKey` changes
 * (filters, search, a different day…), and never points past the last page when rows shrink.
 */
export function usePaged<T>(rows: T[], resetKey: unknown = '', initialSize = 25) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initialSize);
  const key = JSON.stringify(resetKey);
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setPage(1);
  }
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  return {
    rows: rows.slice(start, start + size),
    /** Position of the first row on this page, for numbering (0-based). */
    offset: start,
    pager: { page: current, pages, total, size, onPage: setPage, onSize: (n: number) => { setSize(n); setPage(1); } },
  };
}

export interface PagerProps {
  page: number;
  pages: number;
  total: number;
  size: number;
  onPage: (p: number) => void;
  onSize?: (n: number) => void;
  /** What is being counted, e.g. "partners". */
  noun?: string;
  /** Hide when everything fits on one page and there's no size to choose. */
  compact?: boolean;
}

/** "1–25 of 140 partners · ‹ 1 2 3 … 6 › · 25 per page" under a table. */
export function Pager({ page, pages, total, size, onPage, onSize, noun = 'rows', compact }: PagerProps) {
  if (total === 0) return null;
  if (compact && pages <= 1 && total <= PAGE_SIZES[0]) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  // Page numbers: first, last, and two either side of the current page.
  const nums: (number | '…')[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <nav className="crm-pager" aria-label="Pages">
      <span className="crm-pager-count">{from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')} {noun}</span>
      {pages > 1 && (
        <span className="crm-pager-pages">
          <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={16} aria-hidden /></button>
          {nums.map((n, i) => n === '…'
            ? <span key={`e${i}`} className="crm-pager-gap" aria-hidden>…</span>
            : <button key={n} type="button" aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)} aria-label={`Page ${n}`}>{n}</button>)}
          <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight size={16} aria-hidden /></button>
        </span>
      )}
      {onSize && (
        <label className="crm-pager-size">
          <span>Per page</span>
          <select value={size} onChange={(e) => onSize(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
    </nav>
  );
}
