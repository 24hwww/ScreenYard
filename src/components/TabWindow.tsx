import React, { useRef, useEffect, useState } from 'react';
import { TabData } from '../windows/types';
import './TabWindow.css';

interface TabWindowProps {
  data: TabData;
  windowId: string;
}

/**
 * Displays a live capture of another browser tab inside ScreenYard.
 * The MediaStream is obtained via chrome.tabCapture and stored in a
 * global registry (window.__screenYardTabStreams) keyed by tabId.
 * This component looks up the stream and plays it in a <video> element.
 */
export const TabWindow: React.FC<TabWindowProps> = ({ data, windowId }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Streams are stored in a global registry by the tab capture manager
    const registry = (window as any).__screenYardTabStreams || {};
    const stream: MediaStream | undefined = registry[data.tabId];

    if (stream) {
      video.srcObject = stream;
      video.play().then(() => {
        setStatus('playing');
      }).catch((e) => {
        setStatus('error');
        setErrorMsg('Failed to play stream: ' + e.message);
      });
    } else {
      // Poll for stream — it may not be ready yet
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        const reg = (window as any).__screenYardTabStreams || {};
        const s = reg[data.tabId];
        if (s) {
          clearInterval(interval);
          video.srcObject = s;
          video.play().then(() => setStatus('playing')).catch(() => setStatus('error'));
        } else if (attempts > 50) {
          clearInterval(interval);
          setStatus('error');
          setErrorMsg('Tab stream not available. Make sure the tab is open.');
        }
      }, 200);
      return () => clearInterval(interval);
    }
  }, [data.tabId]);

  return (
    <div className="tab-window">
      <div className="tab-window-header">
        {data.favIconUrl && (
          <img src={data.favIconUrl} alt="" className="tab-window-favicon" />
        )}
        <span className="tab-window-title">{data.title}</span>
      </div>
      <div className="tab-window-content">
        {status === 'loading' && (
          <div className="tab-window-status">⏳ Capturing tab…</div>
        )}
        {status === 'error' && (
          <div className="tab-window-status tab-window-status--error">
            ❌ {errorMsg}
          </div>
        )}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="tab-window-video"
          style={{ visibility: status === 'playing' ? 'visible' : 'hidden' }}
        />
      </div>
    </div>
  );
};
