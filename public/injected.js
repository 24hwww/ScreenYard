/**
 * ScreenYard Virtual Camera — Injected Script (MAIN world)
 *
 * Declared in manifest.json with "world": "MAIN".
 * Runs in the page's main world at document_start.
 *
 * Strategy (multi-layered, Brave-resistant):
 * 1. Override Navigator.prototype.mediaDevices getter → return Proxy
 * 2. Override MediaDevices.prototype methods
 * 3. Override instance methods via defineProperty
 * 4. Direct assignment fallback
 *
 * The Proxy approach is the most robust because it intercepts ALL
 * property access on navigator.mediaDevices, not just specific methods.
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

  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[ScreenYard INJ]');
    console.log.apply(console, args);
  }

  function warn() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[ScreenYard INJ]');
    console.warn.apply(console, args);
  }

  function error() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[ScreenYard INJ]');
    console.error.apply(console, args);
  }

  log('Script loaded at', location.href);

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
      log('Received WebRTC offer');
      handleWebRTCOffer(msg.sdp);
    }

    if (msg.type === 'ice-candidate') {
      if (pc && msg.candidate) {
        try { pc.addIceCandidate({ candidate: msg.candidate }).catch(function () {}); } catch (e) {}
      }
    }

    if (msg.type === 'request-stream-error') {
      warn('Stream request error:', msg.error);
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
        log('Received track from ScreenYard');
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
      log('Sent WebRTC answer');
    } catch (err) {
      error('WebRTC negotiation failed:', err);
      if (pendingReject) { pendingReject(err); pendingReject = null; pendingResolve = null; }
    }
  }

  // ─── Patched methods ───
  function makePatchedEnumerateDevices(origFn) {
    return async function () {
      var devices = [];
      try {
        devices = await origFn.call(this);
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
      log('enumerateDevices called → returning', devices.length, 'devices (ScreenYard:', !exists ? 'added' : 'already present', ')');
      return devices;
    };
  }

  function makePatchedGetUserMedia(origFn) {
    return async function (constraints) {
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
        log('getUserMedia intercepted for virtual camera');

        if (cachedStream && cachedStream.active) {
          log('Returning cached stream');
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

        log('Stream received, returning to caller');
        return stream;
      }

      return origFn.call(this, constraints);
    };
  }

  // ─── Store originals ───
  var origEnumerateDevices = null;
  var origGetUserMedia = null;
  var origMediaDevicesGetter = null;
  var proxyMediaDevices = null;
  var overrideDone = false;

  function saveOriginals(md) {
    if (!origEnumerateDevices && md) {
      origEnumerateDevices = md.enumerateDevices.bind(md);
    }
    if (!origGetUserMedia && md) {
      origGetUserMedia = md.getUserMedia.bind(md);
    }
  }

  // ─── Approach 1: Proxy on navigator.mediaDevices ───
  // This creates a Proxy that wraps the original mediaDevices object.
  // All property access goes through the Proxy, so we can intercept
  // enumerateDevices and getUserMedia without modifying the original.
  function tryProxyOverride() {
    try {
      var md = navigator.mediaDevices;
      if (!md) return false;
      saveOriginals(md);
      if (md.__screenYardProxy) return true;

      proxyMediaDevices = new Proxy(md, {
        get: function (target, prop, receiver) {
          if (prop === '__screenYardProxy') return true;
          if (prop === 'enumerateDevices') {
            return makePatchedEnumerateDevices(target.enumerateDevices.bind(target));
          }
          if (prop === 'getUserMedia') {
            return makePatchedGetUserMedia(target.getUserMedia.bind(target));
          }
          var val = target[prop];
          if (typeof val === 'function') return val.bind(target);
          return val;
        },
      });

      // Try to replace navigator.mediaDevices with our Proxy
      // Approach 1a: Override the getter on Navigator.prototype
      try {
        var proto = Navigator.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, 'mediaDevices');
        if (desc && desc.get) {
          origMediaDevicesGetter = desc.get;
          Object.defineProperty(proto, 'mediaDevices', {
            get: function () { return proxyMediaDevices; },
            configurable: true,
          });
          overrideDone = true;
          log('Proxy override via Navigator.prototype successful');
          return true;
        }
      } catch (e) {
        warn('Navigator.prototype override failed:', e.message);
      }

      // Approach 1b: defineProperty on the navigator instance
      try {
        Object.defineProperty(navigator, 'mediaDevices', {
          get: function () { return proxyMediaDevices; },
          configurable: true,
        });
        overrideDone = true;
        log('Proxy override via navigator instance successful');
        return true;
      } catch (e) {
        warn('navigator instance override failed:', e.message);
      }

      // Approach 1c: direct assignment (least likely to work)
      try {
        navigator.mediaDevices = proxyMediaDevices;
        overrideDone = true;
        log('Proxy override via direct assignment successful');
        return true;
      } catch (e) {
        warn('direct assignment failed:', e.message);
      }
    } catch (e) {
      warn('Proxy override failed entirely:', e.message);
    }
    return false;
  }

  // ─── Approach 2: Override MediaDevices.prototype ───
  function tryPrototypeOverride() {
    try {
      if (typeof MediaDevices !== 'undefined' && MediaDevices.prototype) {
        var proto = MediaDevices.prototype;
        if (!proto.__screenYardOverridden) {
          if (!origEnumerateDevices) origEnumerateDevices = proto.enumerateDevices;
          if (!origGetUserMedia) origGetUserMedia = proto.getUserMedia;

          proto.enumerateDevices = makePatchedEnumerateDevices(origEnumerateDevices);
          proto.getUserMedia = makePatchedGetUserMedia(origGetUserMedia);
          proto.__screenYardOverridden = true;
          overrideDone = true;
          log('Prototype override successful');
          return true;
        }
        return true;
      }
    } catch (e) {
      warn('Prototype override failed:', e.message);
    }
    return false;
  }

  // ─── Approach 3: Override instance methods ───
  function tryInstanceOverride() {
    try {
      var md = navigator.mediaDevices;
      if (!md) return false;
      if (md.__screenYardOverridden) return true;
      saveOriginals(md);

      try {
        Object.defineProperty(md, 'enumerateDevices', {
          value: makePatchedEnumerateDevices(origEnumerateDevices),
          writable: false,
          configurable: false,
        });
        Object.defineProperty(md, 'getUserMedia', {
          value: makePatchedGetUserMedia(origGetUserMedia),
          writable: false,
          configurable: false,
        });
        md.__screenYardOverridden = true;
        overrideDone = true;
        log('Instance override (defineProperty) successful');
        return true;
      } catch (e) {
        warn('defineProperty failed, trying direct assignment:', e.message);
        md.enumerateDevices = makePatchedEnumerateDevices(origEnumerateDevices);
        md.getUserMedia = makePatchedGetUserMedia(origGetUserMedia);
        md.__screenYardOverridden = true;
        overrideDone = true;
        log('Instance override (direct assignment) successful');
        return true;
      }
    } catch (e) {
      warn('Instance override failed entirely:', e.message);
    }
    return false;
  }

  // ─── Main override loop ───
  var attempts = 0;

  function attemptOverride() {
    attempts++;
    if (overrideDone) return;

    if (attempts > 300) {
      error('Gave up after 300 attempts. navigator.mediaDevices never became available.');
      return;
    }

    // Try all approaches, best first
    if (tryProxyOverride()) { dispatchDeviceChanges(); return; }
    if (tryPrototypeOverride()) { dispatchDeviceChanges(); return; }
    if (tryInstanceOverride()) { dispatchDeviceChanges(); return; }

    // Retry — navigator.mediaDevices may not be available at document_start
    setTimeout(attemptOverride, 5);
  }

  function dispatchDeviceChanges() {
    function dispatch() {
      try {
        var md = navigator.mediaDevices;
        if (md) md.dispatchEvent(new Event('devicechange'));
      } catch (e) {}
    }
    setTimeout(dispatch, 50);
    setTimeout(dispatch, 200);
    setTimeout(dispatch, 500);
    setTimeout(dispatch, 1000);
    setTimeout(dispatch, 2000);
    setTimeout(dispatch, 4000);

    // Diagnostic: verify override is working
    setTimeout(function () {
      try {
        var md = navigator.mediaDevices;
        if (!md) { error('navigator.mediaDevices is null after override!'); return; }
        md.enumerateDevices().then(function (devices) {
          var sy = devices.find(function (d) { return d.deviceId === VIRTUAL_DEVICE_ID; });
          if (sy) {
            log('✓ Diagnostic: ScreenYard IS in device list (' + devices.length + ' total devices)');
          } else {
            error('✗ Diagnostic: ScreenYard NOT in device list. Override may have been reverted.');
            log('Devices:', devices.map(function (d) { return d.label || d.deviceId; }));
          }
        }).catch(function (e) {
          warn('Diagnostic enumerateDevices failed:', e.message);
        });
      } catch (e) {
        error('Diagnostic failed:', e.message);
      }
    }, 1500);
  }

  // Start override
  attemptOverride();

  // Also re-check periodically — Brave may revert overrides
  setInterval(function () {
    if (!overrideDone) {
      attemptOverride();
      return;
    }
    // Verify override is still active
    try {
      var md = navigator.mediaDevices;
      if (md && !md.__screenYardProxy && !md.__screenYardOverridden) {
        warn('Override was reverted! Re-applying...');
        overrideDone = false;
        attemptOverride();
      }
    } catch (e) {}
  }, 2000);

  log('Injection complete, override attempts started');
})();
