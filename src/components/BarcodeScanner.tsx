import React, { useRef, useEffect, useState, useCallback } from 'react';
import './BarcodeScanner.css';

// Lazy-loaded to avoid bloating the initial bundle
type ZXingResult = { getText: () => string; getBarcodeFormat: () => any };
type ZXingReader = {
  decodeBitmap: (bitmap: ImageBitmap) => Promise<ZXingResult>;
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

const SCAN_INTERVAL_MS = 500; // throttle: scan every 500ms, not every frame

/**
 * Barcode / QR code scanner.
 * Scans directly from the existing camera video element — no second camera
 * stream needed. The MediaStream is shared between the background video and
 * the scanner.
 *
 * Uses the native BarcodeDetector API (Chrome/Edge) when available,
 * falls back to @zxing/library (Firefox/Safari/all browsers).
 * Also supports pasting an image from the clipboard (Ctrl+V) to scan.
 */
export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  videoRef,
  visible,
  onClose,
  onResult,
}) => {
  const intervalRef = useRef<number | null>(null);
  const nativeDetectorRef = useRef<any>(null);
  const scanningRef = useRef(false);
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
        return prev; // skip duplicate within 2s
      }
      onResult(text, format);
      return { text, format, timestamp: now };
    });
  }, [onResult]);

  // Decode one frame from the video element
  const decodeFrame = useCallback(async (): Promise<void> => {
    if (scanningRef.current) return; // skip if previous decode still running
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      console.debug('[scanner] video not ready:', video?.readyState);
      return;
    }

    scanningRef.current = true;
    try {
      if (hasNative) {
        // Native BarcodeDetector can detect directly from a video element
        if (!nativeDetectorRef.current) {
          const formats = await (window as any).BarcodeDetector.getSupportedFormats();
          console.debug('[scanner] native formats:', formats);
          nativeDetectorRef.current = new (window as any).BarcodeDetector({ formats });
        }
        const codes = await nativeDetectorRef.current.detect(video);
        console.debug('[scanner] native detect result:', codes?.length, 'codes');
        if (codes && codes.length > 0) {
          emitResult(codes[0].rawValue, codes[0].format);
        }
      } else {
        // ZXing: create an ImageBitmap from the current video frame, then decode
        const bitmap = await createImageBitmap(video);
        console.debug('[scanner] bitmap:', bitmap.width, 'x', bitmap.height);
        const reader = await getZxingReader();
        const result = await reader.decodeBitmap(bitmap);
        if (result) {
          emitResult(result.getText(), result.getBarcodeFormat()?.toString() || 'UNKNOWN');
        }
        bitmap.close?.();
      }
    } catch (err) {
      console.debug('[scanner] decode error:', err);
    } finally {
      scanningRef.current = false;
    }
  }, [hasNative, videoRef, emitResult]);

  // Start scanning interval when visible
  useEffect(() => {
    if (!visible) return;

    setError(null);
    setScanning(true);
    setEngine(hasNative ? 'BarcodeDetector (native)' : '@zxing/library');

    // Scan every SCAN_INTERVAL_MS — much more efficient than every rAF frame
    intervalRef.current = window.setInterval(decodeFrame, SCAN_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      scanningRef.current = false;
      setScanning(false);
    };
  }, [visible, hasNative, decodeFrame]);

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
            if (hasNative) {
              if (!nativeDetectorRef.current) {
                const formats = await (window as any).BarcodeDetector.getSupportedFormats();
                nativeDetectorRef.current = new (window as any).BarcodeDetector({ formats });
              }
              const codes = await nativeDetectorRef.current.detect(bitmap);
              if (codes && codes.length > 0) {
                emitResult(codes[0].rawValue, codes[0].format);
              } else {
                setError('No barcode/QR found in pasted image');
              }
            } else {
              const reader = await getZxingReader();
              const result = await reader.decodeBitmap(bitmap);
              if (result) {
                emitResult(result.getText(), result.getBarcodeFormat()?.toString() || 'UNKNOWN');
              }
            }
            bitmap.close?.();
            setError(null);
          } catch (err) {
            console.warn('Paste scan failed:', err);
            setError('No barcode/QR found in pasted image');
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [visible, hasNative, emitResult]);

  if (!visible) return null;

  return (
    <div className="barcode-scanner-overlay" onClick={onClose}>
      <div className="barcode-scanner-panel" onClick={(e) => e.stopPropagation()}>
        <div className="barcode-scanner-header">
          <span className="barcode-scanner-title">📷 Barcode / QR Scanner</span>
          <button className="barcode-scanner-close" onClick={onClose}>✕</button>
        </div>

        {/* Engine badge */}
        {engine && (
          <div className="barcode-scanner-engine">Engine: {engine}</div>
        )}

        {/* Live camera preview so the user can aim at the code */}
        <div className="barcode-scanner-viewport">
          <video
            className="barcode-scanner-video"
            ref={(el) => {
              // Mirror the camera stream into the preview
              if (el && videoRef.current && el.srcObject !== videoRef.current.srcObject) {
                el.srcObject = videoRef.current.srcObject;
                el.play().catch(() => {});
              }
            }}
            autoPlay
            playsInline
            muted
          />
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
