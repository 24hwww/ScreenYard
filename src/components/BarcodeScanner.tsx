import React, { useRef, useEffect, useState, useCallback } from 'react';
import './BarcodeScanner.css';

// Lazy-loaded to avoid bloating the initial bundle
type ZXingResult = { getText: () => string; getBarcodeFormat: () => any };
type ZXingReader = {
  decodeFromImageElement: (img: HTMLImageElement) => Promise<ZXingResult>;
  decodeFromImageUrl: (url: string) => Promise<ZXingResult>;
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
  videoRef: React.RefObject<HTMLVideoElement | null>;
  visible: boolean;
  onClose: () => void;
  onResult: (text: string, format: string) => void;
}

const SCAN_INTERVAL_MS = 400;

// Generate a beep sound using Web Audio API (no external file needed)
function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880; // A5 — pleasant "success" tone
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    ctx.close();
  } catch {
    // AudioContext not available — silent fail
  }
}

/**
 * Barcode / QR code scanner.
 * Captures frames from the camera video to a canvas, then decodes.
 * Uses native BarcodeDetector (Chrome/Edge) or @zxing/library (all browsers).
 * On success: plays a beep, copies to clipboard, auto-closes, shows result.
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
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<string>('');

  const hasNative = typeof (window as any).BarcodeDetector !== 'undefined';

  // Handle successful scan: beep + clipboard + callback + close
  const handleScanSuccess = useCallback((text: string, format: string) => {
    playBeep();
    // Copy to clipboard
    navigator.clipboard.writeText(text).catch(() => {});
    // Notify parent (spawns text window with result)
    onResult(text, format);
    // Auto-close the scanner modal
    onClose();
  }, [onResult, onClose]);

  // Decode one frame: draw video to canvas, then detect
  const decodeFrame = useCallback(async (): Promise<void> => {
    if (scanningRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;

    scanningRef.current = true;
    try {
      // Capture frame to canvas at full resolution (no mirror — raw frame)
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (hasNative) {
        if (!nativeDetectorRef.current) {
          const formats = await (window as any).BarcodeDetector.getSupportedFormats();
          nativeDetectorRef.current = new (window as any).BarcodeDetector({ formats });
        }
        const codes = await nativeDetectorRef.current.detect(canvas);
        if (codes && codes.length > 0) {
          handleScanSuccess(codes[0].rawValue, codes[0].format);
          return;
        }
      } else {
        // ZXing: convert canvas to image element and decode
        const reader = await getZxingReader();
        const dataUrl = canvas.toDataURL('image/png');
        const img = new Image();
        img.src = dataUrl;
        await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
        const result = await reader.decodeFromImageElement(img);
        if (result) {
          handleScanSuccess(result.getText(), result.getBarcodeFormat()?.toString() || 'UNKNOWN');
          return;
        }
      }
    } catch {
      // no code found — normal, keep scanning
    } finally {
      scanningRef.current = false;
    }
  }, [hasNative, videoRef, handleScanSuccess]);

  // Start scanning interval when visible
  useEffect(() => {
    if (!visible) return;

    setError(null);
    setScanning(true);
    setEngine(hasNative ? 'BarcodeDetector (native)' : '@zxing/library');

    // Small delay to let the video element settle
    const startTimer = setTimeout(() => {
      intervalRef.current = window.setInterval(decodeFrame, SCAN_INTERVAL_MS);
    }, 300);

    return () => {
      clearTimeout(startTimer);
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      scanningRef.current = false;
      setScanning(false);
    };
  }, [visible, hasNative, decodeFrame]);

  // Paste from clipboard (Ctrl+V)
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
            bitmap.close?.();

            if (hasNative) {
              if (!nativeDetectorRef.current) {
                const formats = await (window as any).BarcodeDetector.getSupportedFormats();
                nativeDetectorRef.current = new (window as any).BarcodeDetector({ formats });
              }
              const codes = await nativeDetectorRef.current.detect(canvas);
              if (codes && codes.length > 0) {
                handleScanSuccess(codes[0].rawValue, codes[0].format);
                return;
              }
            } else {
              const reader = await getZxingReader();
              const dataUrl = canvas.toDataURL('image/png');
              const img = new Image();
              img.src = dataUrl;
              await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
              const result = await reader.decodeFromImageElement(img);
              if (result) {
                handleScanSuccess(result.getText(), result.getBarcodeFormat()?.toString() || 'UNKNOWN');
                return;
              }
            }
            setError('No barcode/QR found in pasted image');
          } catch (err) {
            console.warn('Paste scan failed:', err);
            setError('No barcode/QR found in pasted image');
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [visible, hasNative, handleScanSuccess]);

  if (!visible) return null;

  return (
    <div className="barcode-scanner-overlay" onClick={onClose}>
      <div className="barcode-scanner-panel" onClick={(e) => e.stopPropagation()}>
        <div className="barcode-scanner-header">
          <span className="barcode-scanner-title">📷 Escáner de Código</span>
          <button className="barcode-scanner-close" onClick={onClose}>✕</button>
        </div>

        {engine && (
          <div className="barcode-scanner-engine">Motor: {engine}</div>
        )}

        {/* Live camera preview */}
        <div className="barcode-scanner-viewport">
          <video
            className="barcode-scanner-video"
            ref={(el) => {
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
          {scanning && <div className="barcode-scanner-status">Escaneando…</div>}
        </div>

        {error && (
          <div className="barcode-scanner-error">{error}</div>
        )}

        <div className="barcode-scanner-hint">
          Apunta la cámara al código de barras o QR.
          También puedes pegar una imagen (Ctrl+V)
        </div>
      </div>
    </div>
  );
};
