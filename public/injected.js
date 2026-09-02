/**
 * ScreenYard Virtual Camera — Injected Script (MAIN world)
 *
 * Runs in the page's main world (injected via <script> tag by content_script.js).
 * Has access to navigator.mediaDevices but NOT to chrome.runtime.
 *
 * Communicates with content_script.js (ISOLATED world) via window.postMessage.
 *
 * This script:
 * 1. Intercepts navigator.mediaDevices.enumerateDevices() → adds virtual camera
 * 2. Intercepts navigator.mediaDevices.getUserMedia() → returns ScreenYard stream
 * 3. Handles WebRTC negotiation to receive the canvas stream from ScreenYard
 */

(function () {
  'use strict';

  // Guard against double injection
  if (window.__screenYardInjected) return;
  window.__screenYardInjected = true;

  const VIRTUAL_DEVICE_ID = 'screenyard-virtual-camera';
  const VIRTUAL_DEVICE_LABEL = 'ScreenYard Virtual Camera';

  // ─── State ───
  let cachedStream = null;
  let pendingResolve = null;
  let pendingReject = null;
  let pc = null;

  // ─── Helper: send message to content_script.js (ISOLATED world) ───
  function sendToContent(message) {
    window.postMessage({
      source: 'screenyard-injected',
      ...message,
    }, '*');
  }

  // ─── Helper: receive messages from content_script.js ───
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'screenyard-content') return;

    const msg = event.data;

    // ─── WebRTC offer from ScreenYard (relayed via background) ───
    if (msg.type === 'webrtc-offer') {
      console.log('[ScreenYard] Injected: received WebRTC offer');
      handleWebRTCOffer(msg.sdp);
    }

    // ─── ICE candidate from ScreenYard ───
    if (msg.type === 'ice-candidate') {
      if (pc && msg.candidate) {
        try {
          pc.addIceCandidate({ candidate: msg.candidate }).catch(() => {});
        } catch (e) {}
      }
    }

    // ─── Stream request error ───
    if (msg.type === 'request-stream-error') {
      console.warn('[ScreenYard] Injected: stream request error:', msg.error);
      if (pendingReject) {
        pendingReject(new Error(msg.error));
        pendingReject = null;
        pendingResolve = null;
      }
    }

    // ─── ScreenYard disconnected ───
    if (msg.type === 'disconnected') {
      console.warn('[ScreenYard] Injected: ScreenYard disconnected');
      cachedStream = null;
      if (pendingReject) {
        pendingReject(new Error('ScreenYard tab was closed'));
        pendingReject = null;
        pendingResolve = null;
      }
    }
  });

  // ─── WebRTC: handle offer from ScreenYard ───
  async function handleWebRTCOffer(offerSdp) {
    try {
      // Close existing PC if any
      if (pc) {
        try { pc.close(); } catch (e) {}
        pc = null;
      }

      pc = new RTCPeerConnection({
        iceServers: [], // loopback, no STUN needed
      });

      // ─── Receive the canvas track ───
      pc.ontrack = function (event) {
        console.log('[ScreenYard] Injected: received track from ScreenYard');
        cachedStream = event.streams[0];

        // Make sure tracks are enabled
        cachedStream.getTracks().forEach(function (track) {
          track.enabled = true;
        });

        if (pendingResolve) {
          pendingResolve(cachedStream);
          pendingResolve = null;
          pendingReject = null;
        }
      };

      // ─── Set remote description (offer from ScreenYard) ───
      await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });

      // ─── Create answer ───
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // ─── Collect ICE candidates ───
      var iceCandidates = [];
      pc.onicecandidate = function (event) {
        if (event.candidate) {
          iceCandidates.push(event.candidate.candidate);
        }
      };

      // Wait briefly for ICE gathering (loopback should be fast)
      await new Promise(function (resolve) { setTimeout(resolve, 300); });

      // ─── Send answer + ICE candidates back to ScreenYard via content script ───
      sendToContent({
        type: 'webrtc-answer',
        answer: pc.localDescription.sdp,
      });
      sendToContent({
        type: 'ice-candidates',
        candidates: iceCandidates,
      });

      console.log('[ScreenYard] Injected: sent WebRTC answer');
    } catch (err) {
      console.error('[ScreenYard] Injected: WebRTC negotiation failed:', err);
      if (pendingReject) {
        pendingReject(err);
        pendingReject = null;
        pendingResolve = null;
      }
    }
  }

  // ─── Intercept navigator.mediaDevices ───
  // Wait for mediaDevices to be available (it might not be ready at document_start)
  function setupInterception() {
    if (!navigator.mediaDevices) {
      // Retry shortly — mediaDevices appears once the page has focus/permission
      setTimeout(setupInterception, 50);
      return;
    }

    var originalMediaDevices = navigator.mediaDevices;
    var originalEnumerateDevices = originalMediaDevices.enumerateDevices.bind(originalMediaDevices);
    var originalGetUserMedia = originalMediaDevices.getUserMedia.bind(originalMediaDevices);

    // ─── Override enumerateDevices ───
    originalMediaDevices.enumerateDevices = async function () {
      var devices = await originalEnumerateDevices();

      // Add our virtual camera if not already present
      var exists = devices.some(function (d) { return d.deviceId === VIRTUAL_DEVICE_ID; });
      if (!exists) {
        devices.push({
          deviceId: VIRTUAL_DEVICE_ID,
          kind: 'videoinput',
          label: VIRTUAL_DEVICE_LABEL,
          groupId: 'screenyard-group',
        });
      }

      return devices;
    };

    // ─── Override getUserMedia ───
    originalMediaDevices.getUserMedia = async function (constraints) {
      // Check if the caller is requesting our virtual camera
      var videoConstraints = constraints && constraints.video;
      var requestedDeviceId = null;

      if (typeof videoConstraints === 'object' && videoConstraints) {
        if (videoConstraints.deviceId) {
          if (typeof videoConstraints.deviceId === 'string') {
            requestedDeviceId = videoConstraints.deviceId;
          } else if (videoConstraints.deviceId.exact) {
            requestedDeviceId = videoConstraints.deviceId.exact;
          } else if (videoConstraints.deviceId.ideal) {
            requestedDeviceId = videoConstraints.deviceId.ideal;
          }
        }
      }

      var isOurDevice = requestedDeviceId === VIRTUAL_DEVICE_ID;

      // Also check if Meet is requesting by label
      if (!isOurDevice && videoConstraints && typeof videoConstraints === 'object') {
        // Some apps match by label after enumerateDevices
      }

      if (isOurDevice) {
        console.log('[ScreenYard] Injected: getUserMedia intercepted for virtual camera');

        // Return cached stream if available and active
        if (cachedStream && cachedStream.active) {
          console.log('[ScreenYard] Injected: returning cached stream');
          return cachedStream;
        }

        // Request stream from ScreenYard via content script → background
        sendToContent({ type: 'request-stream' });

        // Wait for the stream to arrive via WebRTC
        var stream = await new Promise(function (resolve, reject) {
          pendingResolve = resolve;
          pendingReject = reject;

          // Timeout after 15 seconds
          setTimeout(function () {
            if (pendingReject) {
              pendingReject(new Error(
                'ScreenYard Virtual Camera: timed out waiting for stream. ' +
                'Make sure ScreenYard is open and VCam mode is enabled.'
              ));
              pendingResolve = null;
              pendingReject = null;
            }
          }, 15000);
        });

        console.log('[ScreenYard] Injected: stream received, returning to Meet');
        return stream;
      }

      // Normal camera request — pass through to real getUserMedia
      return originalGetUserMedia(constraints);
    };

    // ─── Dispatch devicechange so sites pick up the new device ───
    setTimeout(function () {
      try {
        originalMediaDevices.dispatchEvent(new Event('devicechange'));
      } catch (e) {}
    }, 500);
    setTimeout(function () {
      try {
        originalMediaDevices.dispatchEvent(new Event('devicechange'));
      } catch (e) {}
    }, 2000);

    console.log('[ScreenYard] Injected: virtual camera interception ready');
  }

  // Start interception as early as possible
  setupInterception();

  console.log('[ScreenYard] Injected (MAIN world) loaded');
})();
