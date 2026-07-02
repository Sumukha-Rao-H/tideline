import { TIME_LABELS, type TimeIdx } from '@/lib/dayCycle';

interface TimeControlsProps {
  timeIdx: TimeIdx;
  auto: boolean;
  onTime: (i: TimeIdx) => void;
  onToggleAuto: () => void;
}

// BOTTOM RIGHT: time-of-day pills + the auto-cycle toggle.
export default function TimeControls({ timeIdx, auto, onTime, onToggleAuto }: TimeControlsProps) {
  return (
    <div style={{ position: 'absolute', right: 36, bottom: 36, display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'auto' }}>
      <div style={{ display: 'flex', background: 'rgba(10,14,20,.46)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 40, padding: 5, gap: 2 }}>
        {TIME_LABELS.map((label, i) => (
          <button key={label} onClick={() => onTime(i as TimeIdx)} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, padding: '9px 16px', borderRadius: 30, background: timeIdx === i ? 'rgba(244,182,90,.92)' : 'transparent', color: timeIdx === i ? '#1a1206' : 'rgba(255,255,255,.78)' }}>{label}</button>
        ))}
      </div>
      <button onClick={onToggleAuto} title="Auto cycle" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,.16)', background: auto ? 'rgba(244,182,90,.92)' : 'rgba(255,255,255,.06)', color: auto ? '#1a1206' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontFamily: 'inherit' }}>
        {auto ? '❙❙' : '▶'}
      </button>
    </div>
  );
}
