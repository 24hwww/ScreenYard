/**
 * ScreenYard Virtual Camera — Injected Script (MAIN world)
 *
 * Declared in manifest.json with "world": "MAIN".
 * Runs in the page's main world — has access to navigator.mediaDevices
 * but NOT to chrome.runtime.
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

  var VIRTUAL_DEVICE_ID = 'screenyard-virtual-camera';
  var VIRTUAL_DEVICE_LABEL = 'ScreenYard Virtual Camera';

  // ─── State ───
  var cachedStream = null;
  var pendingResolve = null;
  var pendingReject = null;
  var pc = null;
  var interceptionReady = false;

  // ─── Helper: send message to content_script.js (ISOLATED world) ───
  function sendToContent(message) {
    window.postMessage({
      source: 'screenyard-injected',
      type: message.type,
      answer: message.answer,
      candidates: message.candidates,
    }, '*');
  }

  // ─── Listen for messages from content_script.js ───
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'screenyard-content') return;

    var msg = event.data;

    // ─── WebRTC offer from ScreenYard ───
    if (msg.type === 'webrtc-offer') {
      console.log('[ScreenYard INJ] Received WebRTC offer');
      handleWebRTCOffer(msg.sdp);
    }

    // ─── ICE candidate from ScreenYard ───
    if (msg.type === 'ice-candidate') {
      if (pc && msg.candidate) {
        try {
          pc.addIceCandidate({ candidate: msg.candidate }).catch(function () {});
        } catch (e) {}
      }
    }

    // ─── Stream request error ───
    if (msg.type === 'request-stream-error') {
      console.warn('[ScreenYard INJ] Stream request error:', msg.error);
      if (pendingReject) {
        pendingReject(new Error(msg.error));
        pendingReject = null;
        pendingResolve = null;
      }
    }

    // ─── ScreenYard disconnected ───
    if (msg.type === 'disconnected') {
      console.warn('[ScreenYard INJ] ScreenYard disconnected');
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
      if (pc) {
        try { pc.close(); } catch (e) {}
        pc = null;
      }

      pc = new RTCPeerConnection({ iceServers: [] });

      pc.ontrack = function (event) {
        console.log('[ScreenYard INJ] Received track from ScreenYard');
        cachedStream = event.streams[0];
        cachedStream.getTracks().forEach(function (track) {
          track.enabled = true;
        });
        if (pendingResolve) {
          pendingResolve(cachedStream);
          pendingResolve = null;
          pendingReject = null;
        }
      };

      await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      var iceCandidates = [];
      pc.onicecandidate = function (event) {
        if (event.candidate) {
          iceCandidates.push(event.candidate.candidate);
        }
      };

      // Wait for ICE gathering (loopback is fast)
      await new Promise(function (resolve) { setTimeout(resolve, 300); });

      // Send answer + ICE candidates back to ScreenYard via content script
      sendToContent({ type: 'webrtc-answer', answer: pc.localDescription.sdp });
      sendToContent({ type: 'ice-candidates', candidates: iceCandidates });

      console.log('[ScreenYard INJ] Sent WebRTC answer');
    } catch (err) {
      console.error('[ScreenYard INJ] WebRTC negotiation failed:', err);
      if (pendingReject) {
        pendingReject(err);
        pendingReject = null;
        pendingResolve = null;
      }
    }
  }

  // ─── Intercept navigator.mediaDevices ───
  // Use Object.defineProperty to override before the page accesses it.
  // navigator.mediaDevices may not exist at document_start, so we
  // intercept the property getter on the prototype.
  function setupInterception() {
    if (interceptionReady) return;
    if (!navigator.mediaDevices) {
      // Retry — mediaDevices appears once the page is in a secure context
      setTimeout(setupInterception, 10);
      return;
    }

    var md = navigator.mediaDevices;
    var origEnumerate = md.enumerateDevices.bind(md);
    var origGetUserMedia = md.getUserMedia.bind(md);

    // ─── Override enumerateDevices ───
    md.enumerateDevices = async function () {
      var devices = [];
      try {
        devices = await origEnumerate();
      } catch (e) {
        // If permission not granted yet, enumerateDevices may fail
        // Return just our virtual device
      }

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
    md.getUserMedia = async function (constraints) {
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

      if (requestedDeviceId === VIRTUAL_DEVICE_ID) {
        console.log('[ScreenYard INJ] getUserMedia intercepted for virtual camera');

        if (cachedStream && cachedStream.active) {
          console.log('[ScreenYard INJ] Returning cached stream');
          return cachedStream;
        }

        // Request stream from ScreenYard
        sendToContent({ type: 'request-stream' });

        var stream = await new Promise(function (resolve, reject) {
          pendingResolve = resolve;
          pendingReject = reject;
          setTimeout(function () {
            if (pendingReject) {
              pendingReject(new Error(
                'ScreenYard Virtual Camera: timed out. ' +
                'Make sure ScreenYard is open and VCam mode is enabled.'
              ));
              pendingResolve = null;
              pendingReject = null;
            }
          }, 15000);
        });

        console.log('[ScreenYard INJ] Stream received, returning to caller');
        return stream;
      }

      return origGetUserMedia(constraints);
    };

    interceptionReady = true;
    console.log('[ScreenYard INJ] Virtual camera interception ready');

    // Dispatch devicechange events so sites detect the new device
    setTimeout(function () {
      try { md.dispatchEvent(new Event('devicechange')); } catch (e) {}
    }, 100);
    setTimeout(function () {
      try { md.dispatchEvent(new Event('devicechange')); } catch (e) {}
    }, 1000);
    setTimeout(function () {
      try { md.dispatchEvent(new Event('devicechange')); } catch (e) {}
    }, 3000);
  }

  // Start interception immediately
  setupInterception();

  console.log('[ScreenYard INJ] Injected (MAIN world) loaded');
})();
