import { HOTSPOTS, type HotspotKey } from '@/lib/hotspots';

interface HotspotsProps {
  activeHotspot: HotspotKey | null;
  onEnter: (key: HotspotKey) => void;
  onClick: (key: HotspotKey) => void;
  onArrow: (key: HotspotKey) => void;
}

// Screen-space hotspot markers. The wrappers render at opacity 0 in the top
// left; the animate loop projects each anchor every frame and positions them
// via the [data-hotspot] attribute.
export default function Hotspots({ activeHotspot, onEnter, onClick, onArrow }: HotspotsProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {HOTSPOTS.map((item) => {
        const isActive = activeHotspot === item.key;
        return (
          <div key={item.key} data-hotspot={item.key} style={{ position: 'absolute', left: 0, top: 0, willChange: 'transform', opacity: 0 }}>
            {isActive && (
              <div style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', pointerEvents: 'auto', animation: 'tl-fadeup .26s ease both' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(13,17,24,.6)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 17, padding: '11px 13px 11px 14px', whiteSpace: 'nowrap', boxShadow: '0 20px 54px rgba(0,0,0,.46)' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(244,182,90,.14)', border: '1px solid rgba(244,182,90,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Space Grotesk'", fontWeight: 600, fontSize: 17, color: '#F4B65A' }}>{item.letter}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingRight: 6 }}>
                    <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 600, fontSize: 16, color: '#fff' }}>{item.name}</div>
                    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.6)' }}>{item.sub}</div>
                  </div>
                  <button onClick={() => onArrow(item.key)} style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.06)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>&#8594;</button>
                </div>
                <div style={{ position: 'absolute', left: '50%', top: '100%', width: 1, height: 24, background: 'linear-gradient(rgba(255,255,255,.55),rgba(255,255,255,0))', transform: 'translateX(-50%)' }} />
              </div>
            )}
            <button
              onClick={() => onClick(item.key)}
              onMouseEnter={() => onEnter(item.key)}
              style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-50%,-50%)', width: 22, height: 22, border: 'none', padding: 0, cursor: 'pointer', pointerEvents: 'auto', background: 'transparent' }}
            >
              <span style={{ position: 'absolute', left: '50%', top: '50%', width: 13, height: 13, borderRadius: '50%', background: '#F4B65A', boxShadow: '0 0 16px 3px rgba(244,182,90,.85)', transform: 'translate(-50%,-50%)' }} />
              <span style={{ position: 'absolute', left: '50%', top: '50%', width: 13, height: 13, borderRadius: '50%', border: '1.5px solid rgba(244,182,90,.7)', transform: 'translate(-50%,-50%)', animation: 'tl-pulse 2.6s ease-out infinite' }} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
