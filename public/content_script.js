/**
 * ScreenYard Virtual Camera — Content Script (ISOLATED world)
 *
 * Declared in manifest.json with default world (ISOLATED).
 * Has access to chrome.runtime API for messaging with the background SW.
 *
 * injected.js is declared separately in manifest.json with "world": "MAIN"
 * and runs in the page's main world. They communicate via window.postMessage.
 *
 * This script:
 * 1. Bridges postMessage (from injected.js in MAIN world) ↔ chrome.runtime (to background)
 * 2. Relays WebRTC offers/answers/ICE candidates between injected.js and background
 */

(function () {
  'use strict';

  // ─── Listen for messages from injected.js (MAIN world) via window.postMessage ───
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'screenyard-injected') return;

    const msg = event.data;

    // ─── Injected script is requesting the ScreenYard stream ───
    if (msg.type === 'request-stream') {
      console.log('[ScreenYard CS] Requesting stream from background');
      chrome.runtime.sendMessage({ type: 'screenyard-request-stream' }, function (response) {
        if (chrome.runtime.lastError) {
          console.warn('[ScreenYard CS] Background error:', chrome.runtime.lastError.message);
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
      });
    }

    // ─── Injected script has a WebRTC answer for ScreenYard ───
    if (msg.type === 'webrtc-answer') {
      console.log('[ScreenYard CS] Forwarding answer to background');
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
  });

  // ─── Listen for messages from the background service worker ───
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    // ─── WebRTC offer from ScreenYard ───
    if (message.type === 'screenyard-webrtc-offer') {
      console.log('[ScreenYard CS] Received offer from ScreenYard, forwarding to injected');
      window.postMessage({
        source: 'screenyard-content',
        type: 'webrtc-offer',
        sdp: message.sdp,
      }, '*');
      sendResponse({ ok: true });
      return false;
    }

    // ─── ICE candidate from ScreenYard ───
    if (message.type === 'screenyard-ice-candidate') {
      window.postMessage({
        source: 'screenyard-content',
        type: 'ice-candidate',
        candidate: message.candidate,
      }, '*');
      return false;
    }

    // ─── ScreenYard disconnected ───
    if (message.type === 'screenyard-disconnected') {
      window.postMessage({
        source: 'screenyard-content',
        type: 'disconnected',
      }, '*');
      return false;
    }

    // ─── Stream available ───
    if (message.type === 'screenyard-stream-available') {
      window.postMessage({
        source: 'screenyard-content',
        type: 'stream-available',
      }, '*');
      return false;
    }

    return false;
  });

  console.log('[ScreenYard CS] Content script (ISOLATED) loaded, version: 2025-01-09-v1');
})();
