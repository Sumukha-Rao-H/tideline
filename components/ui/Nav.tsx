export default function Nav() {
  return (
    <div
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '22px 36px', pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{ display: 'inline-block', width: 22, height: 22, background: '#F4B65A', transform: 'rotate(45deg)', borderRadius: 5, boxShadow: '0 0 16px rgba(244,182,90,.6)' }} />
        <span style={{ fontFamily: "'Space Grotesk'", fontWeight: 600, fontSize: 19, letterSpacing: '.08em', color: '#fff' }}>TIDELINE</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
          {['Map', 'Trails', 'Visit', 'Events'].map((l) => (
            <a key={l} style={{ color: 'rgba(255,255,255,.86)', fontSize: 15, textDecoration: 'none', cursor: 'pointer' }}>{l}</a>
          ))}
        </div>
        <button style={{ background: '#fff', color: '#13202e', fontSize: 14, fontWeight: 600, border: 'none', padding: '11px 22px', borderRadius: 40, cursor: 'pointer', fontFamily: 'inherit' }}>Plan your visit</button>
      </div>
    </div>
  );
}
