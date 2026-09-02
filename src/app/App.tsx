import React, { useState, useCallback } from 'react';
import {
  getInitialState,
  addWindow,
  WindowManagerState,
} from '../windows/WindowManager';
import { WindowType } from '../windows/types';
import { Stage } from '../components/Stage';
import { Toolbar } from '../components/Toolbar';
import './App.css';

export const App: React.FC = () => {
  const [windowState, setWindowState] = useState<WindowManagerState>(
    getInitialState(),
  );
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [isDebugVisible, setIsDebugVisible] = useState(true);
  const [scannerVisible, setScannerVisible] = useState(false);

  const handleAddWindow = useCallback(
    (type: WindowType) => {
      setWindowState((prev) => addWindow(prev, type));
    },
    [],
  );

  const handleClearAll = useCallback(() => {
    setWindowState(getInitialState());
  }, []);

  const handleScan = useCallback(() => {
    setScannerVisible(true);
  }, []);

  const handleScannerClose = useCallback(() => {
    setScannerVisible(false);
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
        isPresentationMode={isPresentationMode}
        onTogglePresentation={handleTogglePresentation}
        isDebugVisible={isDebugVisible}
        onToggleDebug={handleToggleDebug}
      />
      <Stage
        state={windowState}
        onStateChange={setWindowState}
        isPresentationMode={isPresentationMode}
        isDebugVisible={isDebugVisible}
        scannerVisible={scannerVisible}
        onScannerClose={handleScannerClose}
      />
    </div>
  );
};
