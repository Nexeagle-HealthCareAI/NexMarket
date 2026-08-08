'use client';

import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import type { LocalPanchayat } from '@/lib/db/schema';

interface AddMissingPanchayatButtonProps {
  deviceId: string | null;
  position?: { lat: number; lng: number } | null;
  onAdded: (panchayat: LocalPanchayat) => void;
}

// The seeded LGD panchayat list isn't exhaustive — an agent standing in a
// panchayat that's missing from it used to be stuck, unable to check in or
// add a contact at all. This lets them add it on the spot: it's written to
// Dexie immediately (usable in the picker right away, no connection needed)
// and queued through the normal outbox so it becomes the shared, canonical
// record once sync has a connection.
export default function AddMissingPanchayatButton({ deviceId, position, onAdded }: AddMissingPanchayatButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  const [block, setBlock] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setOpen(false);
    setName('');
    setDistrict('');
    setBlock('');
    setError('');
  };

  const handleSave = async () => {
    if (!name.trim() || !district.trim() || !block.trim()) {
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
      district: district.trim(),
      block: block.trim(),
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ background: 'none', border: 'none', color: 'var(--color-primary-600)', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', padding: '0.4rem 0', textAlign: 'left' }}
      >
        + Can&apos;t find your panchayat? Add it
      </button>
    );
  }

  return (
    <div style={{ padding: '0.85rem', background: 'var(--surface-input)', borderRadius: 'var(--radius-md)', border: '1px solid var(--surface-border)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', margin: 0 }}>Add Missing Panchayat</p>

      <input
        className="field-input"
        placeholder="Panchayat name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <input className="field-input" placeholder="Block" value={block} onChange={(e) => setBlock(e.target.value)} />
        <input className="field-input" placeholder="District" value={district} onChange={(e) => setDistrict(e.target.value)} />
      </div>

      {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.78rem', margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
          {saving ? 'Saving…' : 'Save Panchayat'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
