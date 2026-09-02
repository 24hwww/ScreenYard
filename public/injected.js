/**
 * ScreenYard Virtual Camera — Injected Script (MAIN world)
 *
 * Declared in manifest.json with "world": "MAIN".
 * Runs in the page's main world at document_start.
 *
 * Strategy: override MediaDevices.prototype methods so that ALL
 * instances (including navigator.mediaDevices) use our overrides.
 * This is more robust than overriding the instance directly because:
 * 1. It works even before navigator.mediaDevices is available
 * 2. It applies even if the page caches a reference to enumerateDevices
 * 3. It's harder for fingerprinting protection to block
 *
 * Communicates with content_script.js (ISOLATED world) via window.postMessage.
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

  // ─── Helper: send message to content_script.js (ISOLATED world) ───
  function sendToContent(msg) {
    window.postMessage({
      source: 'screenyard-injected',
      type: msg.type,
      answer: msg.answer,
      candidates: msg.candidates,
      error: msg.error,
    }, '*');
  }

  // ─── Listen for messages from content_script.js ───
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
        try {
          pc.addIceCandidate({ candidate: msg.candidate }).catch(function () {});
        } catch (e) {}
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

  // ─── Override MediaDevices PROTOTYPE ───
  // This is the key: we override at the prototype level so ALL instances
  // get our methods, even if the page already cached a reference.
  function overridePrototype() {
    // MediaDevices constructor should be available as a global
    // very early in the page lifecycle
    if (typeof MediaDevices === 'undefined') {
      // Retry aggressively — MediaDevices should appear almost immediately
      setTimeout(overridePrototype, 1);
      return;
    }

    var proto = MediaDevices.prototype;

    // Guard against double override
    if (proto.__screenYardOverridden) return;
    proto.__screenYardOverridden = true;

    var origEnumerate = proto.enumerateDevices;
    var origGetUserMedia = proto.getUserMedia;

    // ─── Override enumerateDevices ───
    proto.enumerateDevices = async function () {
      var devices = [];
      try {
        devices = await origEnumerate.call(this);
      } catch (e) {
        // enumerateDevices may fail before permission is granted
      }

      // Always ensure our virtual camera is in the list
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
    proto.getUserMedia = async function (constraints) {
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

      return origGetUserMedia.call(this, constraints);
    };

    console.log('[ScreenYard INJ] MediaDevices.prototype overridden');

    // Dispatch devicechange events so sites detect the new device
    // We need to dispatch on the actual navigator.mediaDevices instance
    function dispatchDeviceChange() {
      try {
        if (navigator.mediaDevices) {
          navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
        }
      } catch (e) {}
    }
    setTimeout(dispatchDeviceChange, 100);
    setTimeout(dispatchDeviceChange, 500);
    setTimeout(dispatchDeviceChange, 1500);
    setTimeout(dispatchDeviceChange, 3000);
  }

  // Start prototype override immediately
  overridePrototype();

  console.log('[ScreenYard INJ] Injected (MAIN world) loaded at', location.href);

  // Diagnostic: test if the override is working
  setTimeout(function () {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.enumerateDevices().then(function (devices) {
        var screenyard = devices.find(function (d) { return d.deviceId === VIRTUAL_DEVICE_ID; });
        console.log('[ScreenYard INJ] enumerateDevices returned', devices.length, 'devices, ScreenYard present:', !!screenyard);
      }).catch(function (e) {
        console.warn('[ScreenYard INJ] enumerateDevices failed:', e);
      });
    } else {
      console.warn('[ScreenYard INJ] navigator.mediaDevices not available');
    }
  }, 2000);
})();
