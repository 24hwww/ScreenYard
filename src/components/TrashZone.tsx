import React from 'react';

interface TrashZoneProps {
  visible: boolean;
  /** 0-1 progress: how close the element is to the trash zone */
  progress: number;
}

/**
 * Full-width trash bar at the bottom of the stage.
 * Appears when dragging any element (mouse or gesture).
 * Gradient from transparent to red, intensifying as the dragged element
 * gets closer. Drop the element here to delete it.
 */
export const TrashZone: React.FC<TrashZoneProps> = ({ visible, progress }) => {
  const p = Math.max(0, Math.min(1, progress));
  const isHot = p > 0.5;

  return (
    <div
      className={`trash-zone ${visible ? 'trash-zone--visible' : ''} ${isHot ? 'trash-zone--hot' : ''}`}
      style={{
        // Gradient: transparent → red, opacity intensifies with progress
        background: `linear-gradient(
          to top,
          rgba(239, 68, 68, ${0.15 + p * 0.75}) 0%,
          rgba(239, 68, 68, ${0.05 + p * 0.3}) 40%,
          rgba(239, 68, 68, 0) 100%
        )`,
      }}
    >
      {/* Top edge glow line — brightens with progress */}
      <div
        className="trash-zone-edge"
        style={{
          opacity: 0.2 + p * 0.8,
          boxShadow: `0 0 ${4 + p * 16}px ${1 + p * 4}px rgba(239, 68, 68, ${0.3 + p * 0.7})`,
        }}
      />

      {/* Content */}
      <div className="trash-zone-content">
        <span
          className="trash-zone-icon"
          style={{ transform: `scale(${1 + p * 0.4})` }}
        >
          {isHot ? '🗑️' : '🗑️'}
        </span>
        <span className="trash-zone-label">
          {isHot ? 'Soltar para eliminar' : 'Arrastrar aquí para eliminar'}
        </span>
      </div>
    </div>
  );
};
