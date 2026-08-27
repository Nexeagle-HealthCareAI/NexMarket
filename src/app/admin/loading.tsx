export default function AdminLoading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', background: 'transparent' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', background: 'white', padding: '2rem 3rem', borderRadius: '16px', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
        <div className="spinner" style={{ width: 48, height: 48, border: '4px solid #f1f5f9', borderTopColor: 'var(--color-primary-600)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <span style={{ color: '#475569', fontWeight: 600, fontSize: '0.95rem' }}>Loading Dashboard...</span>
      </div>
    </div>
  );
}
