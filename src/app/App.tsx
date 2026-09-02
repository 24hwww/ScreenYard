import React, { useState, useCallback } from 'react';
import {
  getInitialState,
  addWindow,
  WindowManagerState,
} from '../windows/WindowManager';
import { WindowType, TabData } from '../windows/types';
import { createWindow } from '../windows/WindowModel';
import { Stage } from '../components/Stage';
import { Toolbar } from '../components/Toolbar';
import './App.css';

interface TabInfo {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

export const App: React.FC = () => {
  const [windowState, setWindowState] = useState<WindowManagerState>(
    getInitialState(),
  );
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [isDebugVisible, setIsDebugVisible] = useState(true);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [vcamActive, setVcamActive] = useState(false);

  const handleAddWindow = useCallback(
    (type: WindowType) => {
      setWindowState((prev) => {
        // Block spawning if an element is already selected
        if (prev.windows.some((w) => w.selected)) return prev;
        return addWindow(prev, type);
      });
    },
    [],
  );

  const handleEmbedTab = useCallback((tab: TabInfo) => {
    // Request tab capture from background
    const isExt = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
    if (isExt) {
      chrome.runtime.sendMessage({ type: 'screenyard-capture-tab', tabId: tab.id }, (response) => {
        if (response?.error) {
          console.error('[ScreenYard] Tab capture failed:', response.error);
          return;
        }
        if (response?.streamId) {
          // Use getUserMedia with the streamId to get the actual MediaStream
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: response.streamId,
              },
            } as any,
          }).then((stream) => {
            // Store stream in global registry
            if (!(window as any).__screenYardTabStreams) {
              (window as any).__screenYardTabStreams = {};
            }
            (window as any).__screenYardTabStreams[tab.id] = stream;
          }).catch((e) => {
            console.error('[ScreenYard] getUserMedia for tab failed:', e);
          });
        }
      });
    }

    // Add the tab window to the stage
    const tabWindow = createWindow('tab', { x: 100, y: 100 }, {
      kind: 'tab',
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
    } as TabData);
    setWindowState((prev) => ({
      ...prev,
      windows: [...prev.windows, tabWindow],
    }));
  }, []);

  const handleClearAll = useCallback(() => {
    setWindowState(getInitialState());
  }, []);

  const handleScan = useCallback(() => {
    setScannerVisible(true);
  }, []);

  const handleScannerClose = useCallback(() => {
    setScannerVisible(false);
  }, []);

  const handleToggleVirtualCamera = useCallback(() => {
    setVcamActive((prev) => !prev);
  }, []);

  const handleTogglePresentation = useCallback(() => {
    setIsPresentationMode((prev) => !prev);
  }, []);

  const handleToggleDebug = useCallback(() => {
    setIsDebugVisible((prev) => !prev);
  }, []);

  // Exit presentation mode with Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPresentationMode) {
        setIsPresentationMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPresentationMode]);

  return (
    <div className="app">
      <Toolbar
        onAddWindow={handleAddWindow}
        onClearAll={handleClearAll}
        onScan={handleScan}
        onToggleVirtualCamera={handleToggleVirtualCamera}
        isVirtualCameraActive={vcamActive}
        isPresentationMode={isPresentationMode}
        onTogglePresentation={handleTogglePresentation}
        isDebugVisible={isDebugVisible}
        onToggleDebug={handleToggleDebug}
        onEmbedTab={handleEmbedTab}
      />
      <Stage
        state={windowState}
        onStateChange={setWindowState}
        isPresentationMode={isPresentationMode}
        isDebugVisible={isDebugVisible}
        scannerVisible={scannerVisible}
        onScannerClose={handleScannerClose}
        vcamActive={vcamActive}
      />
    </div>
  );
};
