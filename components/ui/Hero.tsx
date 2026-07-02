interface HeroProps {
  heroIn: boolean;
  explored: boolean;
  onExplore: () => void;
}

// HERO: centered — fades out as the camera dives in.
export default function Hero({ heroIn, explored, onExplore }: HeroProps) {
  return (
    <div
      style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', textAlign: 'center', paddingBottom: 40,
        opacity: explored ? 0 : heroIn ? 1 : 0,
        transform: explored
          ? 'translateY(-10px) scale(1.06)'
          : heroIn
            ? 'none'
            : 'translateY(14px)',
        // Quick, gentle entry — then a long, eased exit timed to the 2s camera dive.
        transition: explored
          ? 'opacity 1.9s cubic-bezier(.33,0,.25,1), transform 2.1s cubic-bezier(.33,0,.25,1)'
          : 'opacity .8s ease, transform .8s ease',
        pointerEvents: 'none',
      }}
    >
      <span style={{ fontSize: 13, letterSpacing: '.36em', textTransform: 'uppercase', color: 'rgba(255,255,255,.72)' }}>Waterfront Park</span>
      <h1 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 'clamp(64px,12vw,168px)', lineHeight: '.9', letterSpacing: '-.03em', color: '#fff', margin: '16px 0 0', textShadow: '0 4px 50px rgba(0,0,0,.45)' }}>Tideline</h1>
      <p style={{ margin: '24px 0 0', maxWidth: 460, fontSize: 18, lineHeight: 1.5, color: 'rgba(255,255,255,.84)', textShadow: '0 1px 14px rgba(0,0,0,.3)' }}>
        A coastal park reimagined — explore it from first light to the last star.
      </p>
      <div style={{ display: 'flex', gap: 14, marginTop: 34, pointerEvents: explored ? 'none' : 'auto' }}>
        <button onClick={onExplore} style={{ background: '#fff', color: '#13202e', fontSize: 15, fontWeight: 600, border: 'none', padding: '14px 28px', borderRadius: 40, cursor: 'pointer', fontFamily: 'inherit' }}>Explore the map</button>
        <button style={{ background: 'rgba(10,14,20,.5)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,.18)', color: '#fff', fontSize: 15, fontWeight: 500, padding: '14px 28px', borderRadius: 40, cursor: 'pointer', fontFamily: 'inherit' }}>Plan a visit</button>
      </div>
    </div>
  );
}
