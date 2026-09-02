import React from 'react';

interface TrashZoneProps {
  visible: boolean;
  /** 0-1 progress: how close the element is to the trash zone */
  progress: number;
}

/**
 * Full-width trash strip at the bottom of the stage.
 * Appears when dragging any element (mouse or gesture).
 * Drop the element here to delete it.
 */
export const TrashZone: React.FC<TrashZoneProps> = ({ visible, progress }) => {
  if (!visible) return null;

  const isHot = progress > 0.5;

  return (
    <div className={`trash-zone ${isHot ? 'trash-zone--hot' : ''}`}>
      {/* Background glow that intensifies with progress */}
      <div
        className="trash-zone-glow"
        style={{ opacity: 0.15 + progress * 0.6 }}
      />
      {/* Content */}
      <div className="trash-zone-content">
        <span className="trash-zone-icon">🗑️</span>
        <span className="trash-zone-label">
          {isHot ? 'Soltar para eliminar' : 'Arrastrar aquí para eliminar'}
        </span>
      </div>
      {/* Progress bar at the top edge */}
      <div className="trash-zone-progress">
        <div
          className="trash-zone-progress-bar"
          style={{
            width: `${progress * 100}%`,
            background: isHot ? '#ef4444' : '#3b82f6',
          }}
        />
      </div>
    </div>
  );
};
