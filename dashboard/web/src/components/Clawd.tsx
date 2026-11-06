import { cn } from '@/lib/utils';

export type ClawdPose = 'walk' | 'sit' | 'wait' | 'sleep' | 'wrench';

// Pixel Clawd on a 16x12 grid (rows 0-3 are headroom for props). Body rows
// 4-9, arms rows 7-8, legs rows 10-11. Eyes are gaps in the body, drawn in
// the card color, so a closed eye is simply a shorter gap.
export function Clawd({ pose, className }: { pose: ClawdPose; className?: string }) {
  const asleep = pose === 'sleep';
  const eyeH = pose === 'wait' ? 3 : pose === 'sit' ? 1 : asleep ? 0.4 : 2;
  const eyeY = pose === 'sit' ? 6 : 5;
  return (
    <div className={cn('clawd', className)} data-pose={pose} aria-hidden>
      <svg viewBox="0 0 16 12" width="32" height="24" shapeRendering="crispEdges" className="clawd-svg">
        <g className="clawd-figure">
          <g className="clawd-body">
            <rect x="4" y="4" width="8" height="6" />
            <rect x="2" y="7" width="12" height="2" className="clawd-arms" />
            <g className="clawd-eyes" style={{ transformOrigin: '8px 6px' }}>
              <rect x="6" y={eyeY} width="1" height={eyeH} className="clawd-eye" />
              <rect x="9" y={eyeY} width="1" height={eyeH} className="clawd-eye" />
            </g>
            {pose === 'wrench' && (
              <g className="clawd-wrench" style={{ transformOrigin: '14px 9px' }}>
                <rect x="14" y="3" width="1" height="6" />
                <rect x="13" y="2" width="3" height="1" />
                <rect x="13" y="4" width="1" height="1" />
                <rect x="15" y="4" width="1" height="1" />
              </g>
            )}
          </g>
          <g className="clawd-legs-a">
            <rect x="4" y="10" width="1" height="2" />
            <rect x="9" y="10" width="1" height="2" />
          </g>
          <g className="clawd-legs-b">
            <rect x="6" y="10" width="1" height="2" />
            <rect x="11" y="10" width="1" height="2" />
          </g>
        </g>
        {pose === 'wait' && (
          <g className="clawd-bang">
            <rect x="13.5" y="0" width="1.5" height="2.6" />
            <rect x="13.5" y="3.2" width="1.5" height="1" />
          </g>
        )}
        {asleep && (
          <g className="clawd-zzz">
            <rect x="0.5" y="3" width="1" height="1" className="clawd-z" />
            <rect x="2" y="1.5" width="1" height="1" className="clawd-z" />
            <rect x="3.5" y="0" width="1" height="1" className="clawd-z" />
          </g>
        )}
      </svg>
    </div>
  );
}
