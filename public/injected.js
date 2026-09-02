/**
 * ScreenYard Virtual Camera — Injected Script (MAIN world)
 *
 * Declared in manifest.json with "world": "MAIN".
 * Runs in the page's main world at document_start.
 *
 * Strategy: override navigator.mediaDevices instance methods directly
 * using Object.defineProperty for non-configurable overrides.
 * Falls back to prototype override if available.
 *
 * Communicates with content_script.js (ISOLATED world) via window.postMessage.
 */

(function () {
  'use strict';

  if (window.__screenYardInjected) return;
  window.__screenYardInjected = true;

  var VIRTUAL_DEVICE_ID = 'screenyard-virtual-camera';
  var VIRTUAL_DEVICE_LABEL = 'ScreenYard Virtual Camera';

  var cachedStream = null;
  var pendingResolve = null;
  var pendingReject = null;
  var pc = null;
  var overrideAttempts = 0;

  function sendToContent(msg) {
    window.postMessage({
      source: 'screenyard-injected',
      type: msg.type,
      answer: msg.answer,
      candidates: msg.candidates,
      error: msg.error,
    }, '*');
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'screenyard-content') return;

    var msg = event.data;

    if (msg.type === 'webrtc-offer') {
      console.log('[ScreenYard INJ] Received WebRTC offer');
      handleWebRTCOffer(msg.sdp);
    }

    if (msg.type === 'ice-candidate') {
      if (pc && msg.candidate) {
        try { pc.addIceCandidate({ candidate: msg.candidate }).catch(function () {}); } catch (e) {}
      }
    }

    if (msg.type === 'request-stream-error') {
      console.warn('[ScreenYard INJ] Stream request error:', msg.error);
      if (pendingReject) {
        pendingReject(new Error(msg.error || 'Unknown error'));
        pendingReject = null;
        pendingResolve = null;
      }
    }

    if (msg.type === 'disconnected') {
      cachedStream = null;
      if (pendingReject) {
        pendingReject(new Error('ScreenYard tab was closed'));
        pendingReject = null;
        pendingResolve = null;
      }
    }
  });

  async function handleWebRTCOffer(offerSdp) {
    try {
      if (pc) { try { pc.close(); } catch (e) {} pc = null; }

      pc = new RTCPeerConnection({ iceServers: [] });

      pc.ontrack = function (event) {
        console.log('[ScreenYard INJ] Received track from ScreenYard');
        cachedStream = event.streams[0];
        cachedStream.getTracks().forEach(function (track) { track.enabled = true; });
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
        if (event.candidate) iceCandidates.push(event.candidate.candidate);
      };

      await new Promise(function (resolve) { setTimeout(resolve, 300); });

      sendToContent({ type: 'webrtc-answer', answer: pc.localDescription.sdp });
      sendToContent({ type: 'ice-candidates', candidates: iceCandidates });
      console.log('[ScreenYard INJ] Sent WebRTC answer');
    } catch (err) {
      console.error('[ScreenYard INJ] WebRTC negotiation failed:', err);
      if (pendingReject) { pendingReject(err); pendingReject = null; pendingResolve = null; }
    }
  }

  // ─── Our overridden methods ───
  async function patchedEnumerateDevices() {
    var devices = [];
    try {
      devices = await origEnumerateDevices.call(navigator.mediaDevices);
    } catch (e) {}

    var exists = devices.some(function (d) { return d.deviceId === VIRTUAL_DEVICE_ID; });
    if (!exists) {
      devices.push({
        deviceId: VIRTUAL_DEVICE_ID,
        kind: 'videoinput',
        label: VIRTUAL_DEVICE_LABEL,
        groupId: 'screenyard-group',
      });
    }
    console.log('[ScreenYard INJ] enumerateDevices called, returning', devices.length, 'devices (ScreenYard:', exists ? 'already present' : 'added', ')');
    return devices;
  }

  async function patchedGetUserMedia(constraints) {
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

      sendToContent({ type: 'request-stream' });

      var stream = await new Promise(function (resolve, reject) {
        pendingResolve = resolve;
        pendingReject = reject;
        setTimeout(function () {
          if (pendingReject) {
            pendingReject(new Error('ScreenYard Virtual Camera: timed out. Make sure ScreenYard is open and VCam mode is enabled.'));
            pendingResolve = null;
            pendingReject = null;
          }
        }, 15000);
      });

      console.log('[ScreenYard INJ] Stream received, returning to caller');
      return stream;
    }

    return origGetUserMedia.call(navigator.mediaDevices, constraints);
  }

  // ─── Store original methods ───
  var origEnumerateDevices = null;
  var origGetUserMedia = null;

  // ─── Override approach 1: prototype level ───
  function tryOverridePrototype() {
    try {
      if (typeof MediaDevices !== 'undefined' && MediaDevices.prototype) {
        var proto = MediaDevices.prototype;
        if (!proto.__screenYardOverridden) {
          origEnumerateDevices = origEnumerateDevices || proto.enumerateDevices;
          origGetUserMedia = origGetUserMedia || proto.getUserMedia;

          proto.enumerateDevices = patchedEnumerateDevices;
          proto.getUserMedia = patchedGetUserMedia;
          proto.__screenYardOverridden = true;
          console.log('[ScreenYard INJ] Prototype override successful');
          return true;
        }
      }
    } catch (e) {
      console.warn('[ScreenYard INJ] Prototype override failed:', e);
    }
    return false;
  }

  // ─── Override approach 2: instance level via defineProperty ───
  function tryOverrideInstance() {
    try {
      var md = navigator.mediaDevices;
      if (!md) return false;
      if (md.__screenYardOverridden) return true;

      origEnumerateDevices = origEnumerateDevices || md.enumerateDevices.bind(md);
      origGetUserMedia = origGetUserMedia || md.getUserMedia.bind(md);

      // Use defineProperty to make it harder for fingerprinting
      // protection to revert our overrides
      Object.defineProperty(md, 'enumerateDevices', {
        value: patchedEnumerateDevices,
        writable: false,
        configurable: false,
      });
      Object.defineProperty(md, 'getUserMedia', {
        value: patchedGetUserMedia,
        writable: false,
        configurable: false,
      });
      md.__screenYardOverridden = true;
      console.log('[ScreenYard INJ] Instance override successful');
      return true;
    } catch (e) {
      console.warn('[ScreenYard INJ] Instance override failed:', e);
      // If defineProperty fails, try direct assignment as fallback
      try {
        var md2 = navigator.mediaDevices;
        if (md2 && !md2.__screenYardOverridden) {
          origEnumerateDevices = origEnumerateDevices || md2.enumerateDevices.bind(md2);
          origGetUserMedia = origGetUserMedia || md2.getUserMedia.bind(md2);
          md2.enumerateDevices = patchedEnumerateDevices;
          md2.getUserMedia = patchedGetUserMedia;
          md2.__screenYardOverridden = true;
          console.log('[ScreenYard INJ] Instance override (direct assignment) successful');
          return true;
        }
      } catch (e2) {
        console.warn('[ScreenYard INJ] Direct assignment also failed:', e2);
      }
    }
    return false;
  }

  // ─── Main override loop ───
  function attemptOverride() {
    overrideAttempts++;
    if (overrideAttempts > 200) {
      console.error('[ScreenYard INJ] Gave up after 200 attempts. navigator.mediaDevices never became available.');
      return;
    }

    // Try prototype first
    if (tryOverridePrototype()) {
      dispatchDeviceChanges();
      return;
    }

    // Try instance level
    if (navigator.mediaDevices) {
      if (tryOverrideInstance()) {
        dispatchDeviceChanges();
        return;
      }
    }

    // Retry — navigator.mediaDevices may not be available yet at document_start
    setTimeout(attemptOverride, 5);
  }

  function dispatchDeviceChanges() {
    function dispatch() {
      try {
        if (navigator.mediaDevices) {
          navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
        }
      } catch (e) {}
    }
    setTimeout(dispatch, 50);
    setTimeout(dispatch, 200);
    setTimeout(dispatch, 500);
    setTimeout(dispatch, 1500);
    setTimeout(dispatch, 3000);

    // Diagnostic: test enumerateDevices after override
    setTimeout(function () {
      if (navigator.mediaDevices) {
        navigator.mediaDevices.enumerateDevices().then(function (devices) {
          var sy = devices.find(function (d) { return d.deviceId === VIRTUAL_DEVICE_ID; });
          console.log('[ScreenYard INJ] Diagnostic: enumerateDevices returned', devices.length, 'devices. ScreenYard present:', !!sy);
          if (sy) {
            console.log('[ScreenYard INJ] ✓ Virtual camera is in the device list');
          } else {
            console.error('[ScreenYard INJ] ✗ Virtual camera NOT in device list — override may have been reverted');
          }
        }).catch(function (e) {
          console.warn('[ScreenYard INJ] Diagnostic enumerateDevices failed:', e);
        });
      }
    }, 1000);
  }

  // Start override attempts
  attemptOverride();

  console.log('[ScreenYard INJ] Injected (MAIN world) loaded at', location.href);
})();
