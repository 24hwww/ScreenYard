import React from 'react';
import { GesturePoint } from '../gestures/types';

interface VirtualCursorProps {
  position: GesturePoint;
  visible: boolean;
  isPinching: boolean;
  /** 0 = primary, 1 = secondary hand */
  handIndex?: number;
}

/**
 * Renders a virtual cursor at the index finger position.
 * Supports two cursors for two-hand tracking.
 */
export const VirtualCursor: React.FC<VirtualCursorProps> = ({
  position,
  visible,
  isPinching,
  handIndex = 0,
}) => {
  if (!visible) return null;

  const isSecondary = handIndex === 1;

  return (
    <div
      className={`virtual-cursor ${isSecondary ? 'virtual-cursor--secondary' : ''}`}
      style={{
        left: `${position.x * 100}%`,
        top: `${position.y * 100}%`,
      }}
    >
      {/* Outer ring */}
      <div
        className={`virtual-cursor-ring ${isPinching ? 'virtual-cursor-ring--pinching' : ''}`}
      />
      {/* Inner dot */}
      <div
        className={`virtual-cursor-dot ${isPinching ? 'virtual-cursor-dot--pinching' : ''}`}
      />
      {/* Hand index label */}
      {isSecondary && (
        <div className="virtual-cursor-label">R</div>
      )}
    </div>
  );
};
