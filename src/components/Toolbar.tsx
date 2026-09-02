import React from 'react';
import { WindowType } from '../windows/types';
import './Toolbar.css';

interface ToolbarProps {
  onAddWindow: (type: WindowType) => void;
  onClearAll: () => void;
  isPresentationMode: boolean;
  onTogglePresentation: () => void;
  isDebugVisible: boolean;
  onToggleDebug: () => void;
}

const windowTypes: { type: WindowType; label: string; icon: string }[] = [
  { type: 'text', label: 'Text', icon: '📝' },
  { type: 'image', label: 'Image', icon: '🖼️' },
  { type: 'shape', label: 'Shape', icon: '🔷' },
];

export const Toolbar: React.FC<ToolbarProps> = ({
  onAddWindow,
  onClearAll,
  isPresentationMode,
  onTogglePresentation,
  isDebugVisible,
  onToggleDebug,
}) => {
  if (isPresentationMode) return null;

  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <span className="toolbar-label">Add:</span>
        {windowTypes.map(({ type, label, icon }) => (
          <button
            key={type}
            className="toolbar-btn"
            onClick={() => onAddWindow(type)}
            title={`Add ${label}`}
          >
            <span className="toolbar-btn-icon">{icon}</span>
            <span className="toolbar-btn-text">{label}</span>
          </button>
        ))}
        <button
          className="toolbar-btn toolbar-btn--clear"
          onClick={onClearAll}
          title="Clear all elements"
        >
          <span className="toolbar-btn-icon">🗑️</span>
          <span className="toolbar-btn-text">Clear All</span>
        </button>
      </div>
      <div className="toolbar-section">
        <button
          className="toolbar-btn toolbar-btn--toggle"
          onClick={onToggleDebug}
          title="Toggle gesture debug panel"
        >
          {isDebugVisible ? '🐛 Hide Debug' : '🐛 Debug'}
        </button>
        <button
          className="toolbar-btn toolbar-btn--presentation"
          onClick={onTogglePresentation}
          title="Enter presentation mode"
        >
          ▶ Present
        </button>
      </div>
    </div>
  );
};
