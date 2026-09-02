import React, { useRef, useEffect, useState, useCallback } from 'react';
import './BarcodeScanner.css';

// Lazy-loaded to avoid bloating the initial bundle
type ZXingReader = {
  decodeFromImageUrl: (url: string) => Promise<{ getText: () => string; getBarcodeFormat: () => any }>;
};
let zxingReaderPromise: Promise<ZXingReader> | null = null;
async function getZxingReader(): Promise<ZXingReader> {
  if (!zxingReaderPromise) {
    zxingReaderPromise = import('@zxing/library').then(({ BrowserMultiFormatReader }) => {
      return new BrowserMultiFormatReader() as unknown as ZXingReader;
    });
  }
  return zxingReaderPromise;
}

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
 * Uses the native BarcodeDetector API (Chrome/Edge) when available,
 * falls back to @zxing/library (works in Firefox/Safari/all browsers).
 * Also supports pasting an image from the clipboard (Ctrl+V) to scan.
 */
export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  videoRef,
  visible,
  onClose,
  onResult,
}) => {
  const rafRef = useRef<number | null>(null);
  const nativeDetectorRef = useRef<any>(null);
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<string>('');

  const hasNative = typeof (window as any).BarcodeDetector !== 'undefined';

  // Emit result with debounce
  const emitResult = useCallback((text: string, format: string) => {
    const now = Date.now();
    setLastResult((prev) => {
      if (prev && prev.text === text && now - prev.timestamp < 2000) {
        return prev; // skip duplicate
      }
      onResult(text, format);
      return { text, format, timestamp: now };
    });
  }, [onResult]);

  // Decode from canvas using ZXing (fallback for non-Chromium browsers)
  const decodeWithZxing = useCallback(async (canvas: HTMLCanvasElement): Promise<void> => {
    try {
      const reader = await getZxingReader();
      const dataUrl = canvas.toDataURL('image/png');
      const result = await reader.decodeFromImageUrl(dataUrl);
      if (result) {
        emitResult(result.getText(), result.getBarcodeFormat()?.toString() || 'UNKNOWN');
      }
    } catch {
      // no code found — normal
    }
  }, [emitResult]);

  // Decode from canvas using native BarcodeDetector
  const decodeWithNative = useCallback(async (source: CanvasImageSource): Promise<void> => {
    if (!nativeDetectorRef.current) {
      const formats = await (window as any).BarcodeDetector.getSupportedFormats();
      nativeDetectorRef.current = new (window as any).BarcodeDetector({ formats });
    }
    try {
      const codes = await nativeDetectorRef.current.detect(source);
      if (codes && codes.length > 0) {
        emitResult(codes[0].rawValue, codes[0].format);
      }
    } catch {
      // no code found
    }
  }, [emitResult]);

  // Start scanning loop when visible
  useEffect(() => {
    if (!visible) return;

    let active = true;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const startScanning = async () => {
      setError(null);
      setScanning(true);

      if (hasNative) {
        setEngine('BarcodeDetector (native)');
      } else {
        setEngine('@zxing/library');
      }

      const scan = async () => {
        if (!active || !visible) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2 && ctx) {
          // Downscale for performance (max 640px wide)
          const scale = Math.min(1, 640 / video.videoWidth);
          canvas.width = video.videoWidth * scale;
          canvas.height = video.videoHeight * scale;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          if (hasNative) {
            await decodeWithNative(canvas);
          } else {
            await decodeWithZxing(canvas);
          }
        }
        rafRef.current = requestAnimationFrame(scan);
      };
      scan();
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
  }, [visible, hasNative, videoRef, decodeWithNative, decodeWithZxing]);

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

          try {
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            ctx.drawImage(bitmap, 0, 0);

            if (hasNative) {
              await decodeWithNative(canvas);
            } else {
              await decodeWithZxing(canvas);
            }
            setError(null);
          } catch (err) {
            console.warn('Paste scan failed:', err);
            setError('Failed to scan pasted image');
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [visible, hasNative, decodeWithNative, decodeWithZxing]);

  if (!visible) return null;

  return (
    <div className="barcode-scanner-overlay">
      <div className="barcode-scanner-panel">
        <div className="barcode-scanner-header">
          <span className="barcode-scanner-title">📷 Barcode / QR Scanner</span>
          <button className="barcode-scanner-close" onClick={onClose}>✕</button>
        </div>

        {/* Engine badge */}
        {engine && (
          <div className="barcode-scanner-engine">Engine: {engine}</div>
        )}

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
