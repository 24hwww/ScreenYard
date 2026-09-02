import React, { useState } from 'react';
import { WindowType } from '../windows/types';
import './Toolbar.css';

interface TabInfo {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

interface ToolbarProps {
  onAddWindow: (type: WindowType) => void;
  onClearAll: () => void;
  onScan: () => void;
  onToggleVirtualCamera: () => void;
  isVirtualCameraActive: boolean;
  isPresentationMode: boolean;
  onTogglePresentation: () => void;
  isDebugVisible: boolean;
  onToggleDebug: () => void;
  /** Called when user picks a tab to embed */
  onEmbedTab?: (tab: TabInfo) => void;
}

const windowTypes: { type: WindowType; label: string; icon: string }[] = [
  { type: 'text', label: 'Text', icon: '📝' },
  { type: 'image', label: 'Image', icon: '🖼️' },
  { type: 'shape', label: 'Shape', icon: '🔷' },
];

export const Toolbar: React.FC<ToolbarProps> = ({
  onAddWindow,
  onClearAll,
  onScan,
  onToggleVirtualCamera,
  isVirtualCameraActive,
  isPresentationMode,
  onTogglePresentation,
  isDebugVisible,
  onToggleDebug,
  onEmbedTab,
}) => {
  const [showTabPicker, setShowTabPicker] = useState(false);
  const [tabList, setTabList] = useState<TabInfo[]>([]);
  const [loadingTabs, setLoadingTabs] = useState(false);

  if (isPresentationMode) return null;

  const handleTabPicker = async () => {
    if (showTabPicker) {
      setShowTabPicker(false);
      return;
    }
    setLoadingTabs(true);
    setShowTabPicker(true);
    try {
      const isExt = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
      if (isExt) {
        chrome.runtime.sendMessage({ type: 'screenyard-list-tabs' }, (response) => {
          setLoadingTabs(false);
          if (response?.tabs) {
            setTabList(response.tabs);
          }
        });
      } else {
        setLoadingTabs(false);
        setTabList([]);
      }
    } catch {
      setLoadingTabs(false);
    }
  };

  const handlePickTab = (tab: TabInfo) => {
    onEmbedTab?.(tab);
    setShowTabPicker(false);
  };

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
          className="toolbar-btn toolbar-btn--tab"
          onClick={handleTabPicker}
          title="Embed a browser tab (YouTube, etc.)"
        >
          <span className="toolbar-btn-icon">🌐</span>
          <span className="toolbar-btn-text">Tab</span>
        </button>
        <button
          className="toolbar-btn toolbar-btn--scan"
          onClick={onScan}
          title="Scan barcode or QR code"
        >
          <span className="toolbar-btn-icon">📷</span>
          <span className="toolbar-btn-text">Scan</span>
        </button>
        <button
          className={`toolbar-btn ${isVirtualCameraActive ? 'toolbar-btn--vcam-active' : 'toolbar-btn--vcam'}`}
          onClick={onToggleVirtualCamera}
          title="Toggle virtual camera output"
        >
          <span className="toolbar-btn-icon">🎥</span>
          <span className="toolbar-btn-text">{isVirtualCameraActive ? 'VCam ON' : 'VCam'}</span>
        </button>
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

      {showTabPicker && (
        <div className="tab-picker-overlay" onClick={() => setShowTabPicker(false)}>
          <div className="tab-picker" onClick={(e) => e.stopPropagation()}>
            <div className="tab-picker-header">
              <span>Select a tab to embed</span>
              <button className="tab-picker-close" onClick={() => setShowTabPicker(false)}>✕</button>
            </div>
            <div className="tab-picker-list">
              {loadingTabs && <div className="tab-picker-loading">Loading tabs…</div>}
              {!loadingTabs && tabList.length === 0 && (
                <div className="tab-picker-empty">No tabs available. Open a tab first (e.g. YouTube).</div>
              )}
              {tabList.map((tab) => (
                <button
                  key={tab.id}
                  className="tab-picker-item"
                  onClick={() => handlePickTab(tab)}
                >
                  {tab.favIconUrl && <img src={tab.favIconUrl} alt="" className="tab-picker-favicon" />}
                  <span className="tab-picker-title">{tab.title}</span>
                  <span className="tab-picker-url">{new URL(tab.url).hostname}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
