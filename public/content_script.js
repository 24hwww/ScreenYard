/**
 * ScreenYard Virtual Camera — Content Script (ISOLATED world)
 *
 * Runs in the isolated world (default for content scripts).
 * Has access to chrome.runtime API for messaging with the background SW.
 *
 * This script:
 * 1. Injects injected.js into the page's MAIN world (via <script> tag)
 * 2. Bridges postMessage (from injected.js) ↔ chrome.runtime (to background)
 * 3. Handles WebRTC negotiation: receives offers from ScreenYard, sends answers back
 */

(function () {
  'use strict';

  // ─── Inject the MAIN world script ───
  // We inject as a <script> tag so it runs in the page's main world,
  // where it can override navigator.mediaDevices before the page uses it.
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
  } catch (e) {
    console.error('[ScreenYard] Failed to inject script:', e);
  }

  // ─── WebRTC state ───
  let pc = null;
  let resolvePendingStream = null;

  // ─── Listen for messages from injected.js (MAIN world) via window.postMessage ───
  window.addEventListener('message', function (event) {
    // Only accept messages from the same window
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'screenyard-injected') return;

    const msg = event.data;

    // ─── Injected script is requesting the ScreenYard stream ───
    if (msg.type === 'request-stream') {
      console.log('[ScreenYard] Content script: requesting stream from background');
      chrome.runtime.sendMessage({ type: 'screenyard-request-stream' }, function (response) {
        if (chrome.runtime.lastError) {
          console.warn('[ScreenYard] Background error:', chrome.runtime.lastError.message);
          window.postMessage({
            source: 'screenyard-content',
            type: 'request-stream-error',
            error: chrome.runtime.lastError.message,
          }, '*');
          return;
        }
        if (response && response.error) {
          window.postMessage({
            source: 'screenyard-content',
            type: 'request-stream-error',
            error: response.error,
          }, '*');
        }
        // If ok: true, the WebRTC negotiation will happen via separate messages
      });
    }

    // ─── Injected script has a WebRTC answer for ScreenYard ───
    if (msg.type === 'webrtc-answer') {
      console.log('[ScreenYard] Content script: forwarding answer to background');
      chrome.runtime.sendMessage({
        type: 'content-webrtc-answer',
        answer: msg.answer,
      });
    }

    // ─── Injected script has ICE candidates for ScreenYard ───
    if (msg.type === 'ice-candidates') {
      chrome.runtime.sendMessage({
        type: 'content-ice-candidate',
        candidates: msg.candidates,
      });
    }

    // ─── Injected script is ready for an offer ───
    if (msg.type === 'ready-for-offer') {
      console.log('[ScreenYard] Content script: injected is ready for offer');
    }
  });

  // ─── Listen for messages from the background service worker ───
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    // ─── Background is forwarding a WebRTC offer from ScreenYard ───
    if (message.type === 'screenyard-webrtc-offer') {
      console.log('[ScreenYard] Content script: received offer from ScreenYard');
      // Forward to injected.js via postMessage
      window.postMessage({
        source: 'screenyard-content',
        type: 'webrtc-offer',
        sdp: message.sdp,
      }, '*');
      sendResponse({ ok: true });
      return false;
    }

    // ─── Background is forwarding ICE candidates from ScreenYard ───
    if (message.type === 'screenyard-ice-candidate') {
      window.postMessage({
        source: 'screenyard-content',
        type: 'ice-candidate',
        candidate: message.candidate,
      }, '*');
      return false;
    }

    // ─── Background says ScreenYard is disconnected ───
    if (message.type === 'screenyard-disconnected') {
      window.postMessage({
        source: 'screenyard-content',
        type: 'disconnected',
      }, '*');
      return false;
    }

    // ─── Background says stream is available ───
    if (message.type === 'screenyard-stream-available') {
      window.postMessage({
        source: 'screenyard-content',
        type: 'stream-available',
      }, '*');
      return false;
    }

    return false;
  });

  // ─── Also forward WebRTC answer back to background ───
  // The injected.js will send the answer via postMessage,
  // and we forward it to the background which relays to ScreenYard.
  // This is handled in the message listener above.

  console.log('[ScreenYard] Content script (ISOLATED) loaded');
})();
