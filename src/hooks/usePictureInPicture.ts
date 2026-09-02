import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * usePictureInPicture — Document Picture-in-Picture hook
 *
 * Uses the Document Picture-in-Picture API (Chrome 116+) to open a
 * floating always-on-top window and move a DOM element into it.
 *
 * The moved element continues running its JavaScript (camera, canvas,
 * MediaPipe, requestAnimationFrame) inside the PiP window, so the
 * stream stays active even when the main tab is in the background.
 *
 * When the PiP window closes, the element is moved back to its
 * original parent.
 */

interface PiPState {
  isActive: boolean;
  error: string | null;
}

export function usePictureInPicture() {
  const [state, setState] = useState<PiPState>({ isActive: false, error: null });
  const pipWindowRef = useRef<Window | null>(null);
  const originalParentRef = useRef<HTMLElement | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const childParentsRef = useRef<Array<{ child: Node; parent: HTMLElement | null }>>([]);

  // Check if Document PiP is supported
  const isSupported = typeof document !== 'undefined' &&
    'documentPictureInPicture' in document;

  /**
   * Open a PiP window and move the given element into it.
   * The element's JavaScript (camera, canvas, RAF) continues running.
   *
   * On close, the element is moved back to its original parent.
   * If the element is a wrapper created just for PiP, its children
   * are moved back to their original parents instead.
   */
  const openPiP = useCallback(async (element: HTMLElement, width = 640, height = 360) => {
    if (!isSupported) {
      setState({ isActive: false, error: 'Document Picture-in-Picture not supported. Use Chrome 116+.' });
      return;
    }

    try {
      // @ts-expect-error — documentPictureInPicture is not in TS lib yet
      const pipWindow: Window = await document.documentPictureInPicture.requestWindow({
        width,
        height,
      });

      pipWindowRef.current = pipWindow;
      elementRef.current = element;
      originalParentRef.current = element.parentElement;

      // Remember the original parent of each child so we can restore them
      const childParents: Array<{ child: Node; parent: HTMLElement | null }> = [];
      Array.from(element.childNodes).forEach((child) => {
        if (child.nodeType === 1) {
          childParents.push({ child, parent: (child as HTMLElement).parentElement });
        }
      });
      childParentsRef.current = childParents;

      // Copy styles to PiP window so the moved element looks the same
      copyStylesToWindow(pipWindow);

      // Move the element into the PiP window's body
      pipWindow.document.body.style.margin = '0';
      pipWindow.document.body.style.overflow = 'hidden';
      pipWindow.document.body.style.background = '#000';
      pipWindow.document.body.appendChild(element);

      // Handle PiP window close — restore children to their original parents
      pipWindow.addEventListener('pagehide', () => {
        // Move each child back to its original parent
        for (const { child, parent } of childParentsRef.current) {
          if (parent && parent.isConnected) {
            parent.appendChild(child);
          }
        }
        childParentsRef.current = [];

        // Remove the wrapper element if it was created just for PiP
        if (elementRef.current && elementRef.current.parentElement) {
          elementRef.current.parentElement.removeChild(elementRef.current);
        }

        pipWindowRef.current = null;
        elementRef.current = null;
        originalParentRef.current = null;
        setState({ isActive: false, error: null });
      });

      setState({ isActive: true, error: null });
    } catch (err: any) {
      setState({ isActive: false, error: err?.message || 'Failed to open floating window' });
    }
  }, [isSupported]);

  /**
   * Close the PiP window and move the element back.
   */
  const closePiP = useCallback(() => {
    if (pipWindowRef.current) {
      pipWindowRef.current.close();
      // The pagehide handler will restore the element
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pipWindowRef.current) {
        try { pipWindowRef.current.close(); } catch {}
      }
    };
  }, []);

  return {
    isActive: state.isActive,
    error: state.error,
    isSupported,
    openPiP,
    closePiP,
  };
}

/**
 * Copy all stylesheets from the main document to the PiP window
 * so the moved element renders correctly.
 */
function copyStylesToWindow(pipWindow: Window): void {
  // Copy all <style> and <link> elements
  const styleElements = document.querySelectorAll('style, link[rel="stylesheet"]');

  styleElements.forEach((node) => {
    if (node.tagName === 'STYLE') {
      const clone = pipWindow.document.createElement('style');
      clone.textContent = node.textContent;
      pipWindow.document.head.appendChild(clone);
    } else if (node.tagName === 'LINK') {
      const link = node as HTMLLinkElement;
      const clone = pipWindow.document.createElement('link');
      clone.rel = 'stylesheet';
      clone.href = link.href;
      pipWindow.document.head.appendChild(clone);
    }
  });
}
