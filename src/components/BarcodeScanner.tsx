import React, { useRef, useEffect, useState, useCallback } from 'react';
import './BarcodeScanner.css';

interface BarcodeScannerProps {
  /** Stream from the camera to scan */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  visible: boolean;
  onClose: () => void;
  /** Called when a code is successfully scanned/pasted */
  onResult: (text: string, format: string) => void;
}

interface ScanResult {
  text: string;
  format: string;
  timestamp: number;
}

/**
 * Barcode / QR code scanner.
 * Uses the native BarcodeDetector API (Chrome/Edge) when available.
 * Also supports pasting an image from the clipboard (Ctrl+V) to scan.
 */
export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  videoRef,
  visible,
  onClose,
  onResult,
}) => {
  const scanCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<any>(null);
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  // Check if BarcodeDetector is available
  useEffect(() => {
    if (typeof (window as any).BarcodeDetector === 'undefined') {
      setSupported(false);
      setError('BarcodeDetector API not available in this browser. Use Chrome or Edge, or paste an image (Ctrl+V).');
    }
  }, []);

  // Start scanning loop when visible
  useEffect(() => {
    if (!visible || !supported) return;

    let active = true;

    const startScanning = async () => {
      try {
        if (detectorRef.current === null) {
          // Get all supported formats
          const formats = await (window as any).BarcodeDetector.getSupportedFormats();
          detectorRef.current = new (window as any).BarcodeDetector({ formats });
        }
        setScanning(true);
        setError(null);

        const scan = async () => {
          if (!active || !visible) return;
          const video = videoRef.current;
          if (video && video.readyState >= 2) {
            try {
              const codes = await detectorRef.current.detect(video);
              if (codes && codes.length > 0) {
                const code = codes[0];
                const text = code.rawValue;
                const format = code.format;
                const now = Date.now();
                // Debounce: don't re-emit the same code within 2s
                if (lastResult && lastResult.text === text && now - lastResult.timestamp < 2000) {
                  // skip
                } else {
                  setLastResult({ text, format, timestamp: now });
                  onResult(text, format);
                }
              }
            } catch {
              // detection error — just continue
            }
          }
          rafRef.current = requestAnimationFrame(scan);
        };
        scan();
      } catch (err) {
        console.warn('Scanner init failed:', err);
        setError('Failed to initialize scanner');
      }
    };

    startScanning();

    return () => {
      active = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setScanning(false);
    };
  }, [visible, supported, videoRef, onResult, lastResult]);

  // Paste from clipboard (Ctrl+V) — scan image for codes
  useEffect(() => {
    if (!visible) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (!blob) continue;

          // Create image bitmap from pasted file
          try {
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            ctx.drawImage(bitmap, 0, 0);

            if (detectorRef.current === null && typeof (window as any).BarcodeDetector !== 'undefined') {
              const formats = await (window as any).BarcodeDetector.getSupportedFormats();
              detectorRef.current = new (window as any).BarcodeDetector({ formats });
            }

            if (detectorRef.current) {
              const codes = await detectorRef.current.detect(canvas);
              if (codes && codes.length > 0) {
                const text = codes[0].rawValue;
                const format = codes[0].format;
                setLastResult({ text, format, timestamp: Date.now() });
                onResult(text, format);
              } else {
                setError('No barcode/QR found in pasted image');
              }
            } else {
              setError('BarcodeDetector not available');
            }
          } catch (err) {
            console.warn('Paste scan failed:', err);
            setError('Failed to scan pasted image');
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [visible, onResult]);

  if (!visible) return null;

  return (
    <div className="barcode-scanner-overlay">
      <div className="barcode-scanner-panel">
        <div className="barcode-scanner-header">
          <span className="barcode-scanner-title">📷 Barcode / QR Scanner</span>
          <button className="barcode-scanner-close" onClick={onClose}>✕</button>
        </div>

        {/* Scanning viewport */}
        <div className="barcode-scanner-viewport">
          <div className="barcode-scanner-reticle" data-scanning={scanning} />
          {scanning && <div className="barcode-scanner-status">Scanning…</div>}
        </div>

        {/* Error */}
        {error && (
          <div className="barcode-scanner-error">{error}</div>
        )}

        {/* Result */}
        {lastResult && (
          <div className="barcode-scanner-result">
            <div className="barcode-scanner-result-format">{lastResult.format}</div>
            <div className="barcode-scanner-result-text">{lastResult.text}</div>
            <button
              className="barcode-scanner-copy"
              onClick={() => {
                navigator.clipboard.writeText(lastResult.text).catch(() => {});
              }}
            >
              Copy
            </button>
          </div>
        )}

        {/* Hint */}
        <div className="barcode-scanner-hint">
          Point camera at a QR code or barcode, or paste an image (Ctrl+V)
        </div>
      </div>
    </div>
  );
};
