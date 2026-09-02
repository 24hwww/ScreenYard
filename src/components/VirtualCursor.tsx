import React from 'react';
import { GesturePoint } from '../gestures/types';

interface VirtualCursorProps {
  position: GesturePoint;
  visible: boolean;
  isPinching: boolean;
  /** 0-1 how close the pinch is to triggering (0 = far, 1 = pinching) */
  pinchProximity?: number;
  /** 0 = primary, 1 = secondary hand */
  handIndex?: number;
  /** 0-1 hold progress for finger-count gesture (primary hand only) */
  holdProgress?: number;
  /** Label to show during hold (e.g. "Text", "Image", "Switch Camera") */
  holdLabel?: string;
}

/**
 * Renders a virtual cursor at the index finger position.
 * Supports two cursors for two-hand tracking.
 */
export const VirtualCursor: React.FC<VirtualCursorProps> = ({
  position,
  visible,
  isPinching,
  pinchProximity = 0,
  handIndex = 0,
  holdProgress = 0,
  holdLabel,
}) => {
  if (!visible) return null;

  const isSecondary = handIndex === 1;
  const showHoldRing = holdProgress > 0 && holdProgress < 1 && !isSecondary;
  // Show proximity ring when fingers are getting close but not yet pinching
  const showProximity = !isPinching && pinchProximity > 0.3 && !showHoldRing;

  return (
    <div
      className={`virtual-cursor ${isSecondary ? 'virtual-cursor--secondary' : ''}`}
      style={{
        left: `${position.x * 100}%`,
        top: `${position.y * 100}%`,
      }}
    >
      {/* Hold progress ring (SVG) */}
      {showHoldRing && (
        <svg
          className="virtual-cursor-hold-ring"
          width="44"
          height="44"
          viewBox="0 0 44 44"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        >
          <circle
            cx="22"
            cy="22"
            r="20"
            fill="none"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="3"
          />
          <circle
            cx="22"
            cy="22"
            r="20"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 20}`}
            strokeDashoffset={`${2 * Math.PI * 20 * (1 - holdProgress)}`}
            transform="rotate(-90 22 22)"
            style={{ transition: 'stroke-dashoffset 0.05s linear' }}
          />
        </svg>
      )}
      {/* Pinch proximity ring — shows when fingers are approaching pinch */}
      {showProximity && (
        <div
          className="virtual-cursor-proximity"
          style={{
            opacity: pinchProximity,
            transform: `translate(-50%, -50%) scale(${0.8 + pinchProximity * 0.4})`,
          }}
        />
      )}

      {/* Outer ring */}
      <div
        className={`virtual-cursor-ring ${isPinching ? 'virtual-cursor-ring--pinching' : ''}`}
      />
      {/* Inner dot */}
      <div
        className={`virtual-cursor-dot ${isPinching ? 'virtual-cursor-dot--pinching' : ''}`}
      />
      {/* Hold label (shows what will be spawned) */}
      {showHoldRing && holdLabel && (
        <div className="virtual-cursor-hold-label">{holdLabel}</div>
      )}

      {/* Hand index label */}
      {isSecondary && (
        <div className="virtual-cursor-label">R</div>
      )}
    </div>
  );
};
