'use client';

import { useMemo, useState } from 'react';
import { MapPin, Search, X } from 'lucide-react';

export interface Place { id: string; name: string; block: string; district: string; active: boolean }
export interface Places { districts: string[]; blocks: string[]; panchayats: string[] }

type Hit = { kind: 'district' | 'block' | 'panchayat'; key: string; label: string; sub: string };

/**
 * Pick districts, blocks and panchayats together: one search box finds any of them; quick chips for the districts and
 * for the blocks inside the chosen districts. A person in any chosen place gets the message.
 */
export function PlacePicker({ places, value, onChange }: { places: Place[]; value: Places; onChange: (v: Places) => void }) {
  const [q, setQ] = useState('');
  const districts = useMemo(() => [...new Set(places.map((p) => p.district))].sort(), [places]);
  const blocksOf = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const p of places) { if (!m.has(p.district)) m.set(p.district, new Set()); m.get(p.district)!.add(p.block); }
    return m;
  }, [places]);
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  const hits = useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const out: Hit[] = [];
    for (const d of districts) if (d.toLowerCase().includes(s)) out.push({ kind: 'district', key: d, label: d, sub: 'District' });
    for (const [d, bs] of blocksOf) for (const b of bs) if (b.toLowerCase().includes(s)) out.push({ kind: 'block', key: b, label: b, sub: `Block · ${d}` });
    for (const p of places) if (p.name.toLowerCase().includes(s)) out.push({ kind: 'panchayat', key: p.id, label: p.name, sub: `Panchayat · ${p.block}, ${p.district}` });
    const rank = (h: Hit) => (h.label.toLowerCase().startsWith(s) ? 0 : 1);
    return out.sort((a, b) => rank(a) - rank(b)).slice(0, 12);
  }, [q, districts, blocksOf, places]);

  const has = (h: Pick<Hit, 'kind' | 'key'>) => (h.kind === 'district' ? value.districts : h.kind === 'block' ? value.blocks : value.panchayats).includes(h.key);
  const toggle = (h: Pick<Hit, 'kind' | 'key'>) => {
    const k = h.kind === 'district' ? 'districts' : h.kind === 'block' ? 'blocks' : 'panchayats';
    const list = value[k];
    onChange({ ...value, [k]: list.includes(h.key) ? list.filter((x) => x !== h.key) : [...list, h.key] });
  };

  const none = !value.districts.length && !value.blocks.length && !value.panchayats.length;
  // Blocks to offer as chips: those in the chosen districts, or (none chosen) the blocks the team works in.
  const chipBlocks = useMemo(() => {
    if (value.districts.length) return value.districts.flatMap((d) => [...(blocksOf.get(d) ?? [])]).sort();
    return [...new Set(places.filter((p) => p.active).map((p) => p.block))].sort();
  }, [value.districts, blocksOf, places]);

  return (
    <div className="plp">
      <div className="plp-search">
        <Search size={16} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a district, block or panchayat…" aria-label="Find a place" />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Clear"><X size={15} /></button>}
      </div>
      {hits.length > 0 && (
        <ul className="plp-hits" role="listbox" aria-label="Places found">
          {hits.map((h) => (
            <li key={h.kind + h.key}>
              <button type="button" role="option" aria-selected={has(h)} onClick={() => { toggle(h); setQ(''); }}>
                <MapPin size={14} aria-hidden /><strong>{h.label}</strong><span>{h.sub}</span>{has(h) && <em>added</em>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && hits.length === 0 && <span className="plp-empty">No place with that name.</span>}

      <div className="plp-row">
        <span className="plp-label">Districts</span>
        <div className="crm-chips">
          {districts.map((d) => (
            <button key={d} type="button" className="crm-chip is-soft" aria-pressed={value.districts.includes(d)} onClick={() => toggle({ kind: 'district', key: d })}>{d}</button>
          ))}
        </div>
      </div>
      {chipBlocks.length > 0 && (
        <div className="plp-row">
          <span className="plp-label">Blocks{value.districts.length ? '' : ' you work in'}</span>
          <div className="crm-chips">
            {chipBlocks.map((b) => (
              <button key={b} type="button" className="crm-chip is-soft" aria-pressed={value.blocks.includes(b)} onClick={() => toggle({ kind: 'block', key: b })}>{b}</button>
            ))}
          </div>
        </div>
      )}

      <div className="plp-picked" aria-live="polite">
        {none ? <span className="plp-all"><MapPin size={14} aria-hidden /> Everywhere. Pick places above to narrow it down.</span> : (
          <>
            {value.districts.map((d) => <Picked key={'d' + d} label={d} sub="district" onRemove={() => toggle({ kind: 'district', key: d })} />)}
            {value.blocks.map((b) => <Picked key={'b' + b} label={b} sub="block" onRemove={() => toggle({ kind: 'block', key: b })} />)}
            {value.panchayats.map((id) => <Picked key={'p' + id} label={byId.get(id)?.name ?? id} sub="panchayat" onRemove={() => toggle({ kind: 'panchayat', key: id })} />)}
            <button type="button" className="plp-clear" onClick={() => onChange({ districts: [], blocks: [], panchayats: [] })}>Clear all</button>
          </>
        )}
      </div>
    </div>
  );
}

function Picked({ label, sub, onRemove }: { label: string; sub: string; onRemove: () => void }) {
  return (
    <span className="plp-tag">
      {label}<small>{sub}</small>
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`}><X size={13} /></button>
    </span>
  );
}
