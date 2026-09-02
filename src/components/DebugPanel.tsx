import React from 'react';
import { GestureState } from '../gestures/types';

interface DebugPanelProps {
  gestureState: GestureState;
  visible: boolean;
}

function orientationIcon(o: string): string {
  switch (o) {
    case 'palm': return '🖐️';
    case 'back': return '🤚';
    case 'side': return '👋';
    default: return '❓';
  }
}

function poseIcon(p: string): string {
  switch (p) {
    case 'open': return '🖐️';
    case 'pinch': return '🤏';
    case 'fist': return '✊';
    case 'point': return '👆';
    default: return '❓';
  }
}

function gestureIcon(g: string): string {
  switch (g) {
    case 'thumb_up': return '👍';
    case 'peace': return '✌️';
    default: return '—';
  }
}

/** Visual finger count display */
function FingerCountBar({ count }: { count: number }) {
  const fingers = ['🤙', '☝️', '✌️', '🖖', '🖐️'];
  return (
    <span className="debug-finger-count">
      {fingers.slice(0, count).join(' ')}
      {count === 0 && <span style={{ opacity: 0.3 }}>✊ 0</span>}
    </span>
  );
}

export const DebugPanel: React.FC<DebugPanelProps> = ({ gestureState, visible }) => {
  if (!visible) return null;

  return (
    <div className="debug-panel">
      <div className="debug-panel-title">Gesture Debug</div>

      <HandDebugSection
        title="✋ Left Hand"
        detected={gestureState.handDetected}
        confidence={gestureState.confidence}
        indexPosition={gestureState.indexPosition}
        isPinching={gestureState.isPinching}
        orientation={gestureState.orientation}
        pose={gestureState.pose}
        fingerCount={gestureState.fingerCount}
        gesture={gestureState.gesture}
      />

      {gestureState.secondHand ? (
        <HandDebugSection
          title="🤚 Right Hand"
          detected={true}
          confidence={gestureState.secondHand.confidence}
          indexPosition={gestureState.secondHand.indexPosition}
          isPinching={gestureState.secondHand.isPinching}
          orientation={gestureState.secondHand.orientation}
          pose={gestureState.secondHand.pose}
          fingerCount={gestureState.secondHand.fingerCount}
          gesture={gestureState.secondHand.gesture}
          secondary
        />
      ) : (
        <div className="debug-panel-hand debug-panel-hand--secondary">
          <div className="debug-panel-hand-title">🤚 Right Hand</div>
          <div className="debug-panel-row">
            <span className="debug-value" style={{ opacity: 0.4 }}>Not detected</span>
          </div>
        </div>
      )}
    </div>
  );
};

interface HandDebugSectionProps {
  title: string;
  detected: boolean;
  confidence: number;
  indexPosition: { x: number; y: number };
  isPinching: boolean;
  orientation: string;
  pose: string;
  fingerCount: number;
  gesture: string;
  secondary?: boolean;
}

const HandDebugSection: React.FC<HandDebugSectionProps> = ({
  title, detected, confidence, indexPosition, isPinching,
  orientation, pose, fingerCount, gesture, secondary,
}) => (
  <div className={`debug-panel-hand ${secondary ? 'debug-panel-hand--secondary' : ''}`}>
    <div className="debug-panel-hand-title">{title}</div>
    <div className="debug-panel-row">
      <span className="debug-label">Hand:</span>
      <span className={`debug-value ${detected ? 'debug-value--active' : ''}`}>
        {detected ? '✅' : '❌'}
      </span>
    </div>
    <div className="debug-panel-row">
      <span className="debug-label">Confidence:</span>
      <span className="debug-value">{(confidence * 100).toFixed(0)}%</span>
    </div>
    <div className="debug-panel-row">
      <span className="debug-label">Position:</span>
      <span className="debug-value">{indexPosition.x.toFixed(2)}, {indexPosition.y.toFixed(2)}</span>
    </div>
    <div className="debug-panel-row">
      <span className="debug-label">Pinch:</span>
      <span className={`debug-value ${isPinching ? 'debug-value--pinching' : ''}`}>
        {isPinching ? '🤏' : 'Open'}
      </span>
    </div>
    <div className="debug-panel-row">
      <span className="debug-label">Fingers:</span>
      <span className="debug-value">
        <FingerCountBar count={fingerCount} /> ({fingerCount})
      </span>
    </div>
    <div className="debug-panel-row">
      <span className="debug-label">Orientation:</span>
      <span className="debug-value">{orientationIcon(orientation)} {orientation}</span>
    </div>
    <div className="debug-panel-row">
      <span className="debug-label">Pose:</span>
      <span className="debug-value">{poseIcon(pose)} {pose}</span>
    </div>
    {gesture !== 'none' && (
      <div className="debug-panel-row">
        <span className="debug-label">Gesture:</span>
        <span className="debug-value debug-value--gesture">{gestureIcon(gesture)} {gesture}</span>
      </div>
    )}
  </div>
);
