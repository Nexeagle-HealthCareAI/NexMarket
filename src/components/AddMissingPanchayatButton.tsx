'use client';

import { useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AnimatePresence, motion } from 'framer-motion';
import { db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import type { LocalPanchayat } from '@/lib/db/schema';

interface AddMissingPanchayatButtonProps {
  deviceId: string | null;
  position?: { lat: number; lng: number } | null;
  panchayats: LocalPanchayat[] | undefined;
  onAdded: (panchayat: LocalPanchayat) => void;
}

// The seeded LGD panchayat list isn't exhaustive — an agent standing in a
// panchayat that's missing from it used to be stuck, unable to check in or
// add a contact at all. This lets them add it on the spot: it's written to
// Dexie immediately (usable in the picker right away, no connection needed)
// and queued through the normal outbox so it becomes the shared, canonical
// record once sync has a connection. District/Block are constrained to a
// dropdown sourced from existing panchayats (not free text) so agents can't
// introduce a typo'd district/block that then never matches anything.
export default function AddMissingPanchayatButton({ deviceId, position, panchayats, onAdded }: AddMissingPanchayatButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  const [block, setBlock] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const uniqueDistricts = useMemo(
    () => Array.from(new Set((panchayats ?? []).map((p) => p.district))).sort(),
    [panchayats],
  );
  const uniqueBlocks = useMemo(
    () => Array.from(new Set((panchayats ?? []).filter((p) => p.district === district).map((p) => p.block))).sort(),
    [panchayats, district],
  );

  const reset = () => {
    setOpen(false);
    setName('');
    setDistrict('');
    setBlock('');
    setError('');
  };

  const handleSave = async () => {
    if (!name.trim() || !district || !block) {
      setError('Name, district and block are all required.');
      return;
    }
    if (!deviceId) {
      setError('Not ready yet — try again in a moment.');
      return;
    }

    setSaving(true);
    setError('');

    const panchayat: LocalPanchayat = {
      id: uuidv4(),
      lgdCode: '',
      name: name.trim(),
      district,
      block,
      state: 'Bihar',
      centroidLat: position?.lat,
      centroidLng: position?.lng,
    };

    try {
      await db.panchayats.add(panchayat);
      await addToOutbox(panchayat.id, deviceId, 'panchayat', panchayat);
      onAdded(panchayat);
      reset();
    } catch {
      setError('Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ background: 'none', border: 'none', color: 'var(--color-primary-600)', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', padding: '0.4rem 0', textAlign: 'left' }}
      >
        + Can&apos;t find your panchayat? Add it
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !saving && reset()}
              style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(2px)', zIndex: 9998 }}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
              style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 420,
                background: 'var(--surface-card, #fff)', borderLeft: '1px solid var(--surface-border)',
                boxShadow: '-8px 0 32px rgba(0,0,0,0.25)', zIndex: 9999, overflowY: 'auto',
                padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '1.15rem', color: 'var(--text-primary)', margin: 0 }}>Add Missing Panchayat</h2>
                <button type="button" onClick={reset} disabled={saving} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.25rem', cursor: 'pointer' }}>✖</button>
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                Not in the list yet? Add it here — it&apos;ll be usable right away, even offline.
              </p>

              <div className="field-group" style={{ margin: 0 }}>
                <label className="field-label">Panchayat Name</label>
                <input className="field-input" placeholder="Panchayat name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>

              <div className="field-group" style={{ margin: 0 }}>
                <label className="field-label">District</label>
                <select
                  className="field-input"
                  value={district}
                  onChange={(e) => { setDistrict(e.target.value); setBlock(''); }}
                >
                  <option value="">Select District...</option>
                  {uniqueDistricts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div className="field-group" style={{ margin: 0 }}>
                <label className="field-label">Block</label>
                <select
                  className="field-input"
                  value={block}
                  onChange={(e) => setBlock(e.target.value)}
                  disabled={!district}
                >
                  <option value="">{district ? 'Select Block...' : 'Select a district first'}</option>
                  {uniqueBlocks.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.82rem', margin: 0 }}>{error}</p>}

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '1rem' }}>
                <button type="button" className="btn btn-ghost" onClick={reset} disabled={saving} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1.5 }}>
                  {saving ? 'Saving…' : 'Save Panchayat'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
