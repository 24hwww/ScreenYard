/**
 * ScreenYard Virtual Camera — Content Script
 *
 * Injected into video call pages (Meet, Zoom, Teams, etc.) at document_start
 * in the MAIN world (so it runs before the page's own scripts).
 *
 * Intercepts navigator.mediaDevices to:
 * 1. Add "ScreenYard Virtual Camera" to enumerateDevices()
 * 2. Return the ScreenYard canvas stream from getUserMedia() when that device is selected
 *
 * The stream is transferred from the ScreenYard tab via a loopback RTCPeerConnection,
 * coordinated through the background service worker.
 */

(function () {
  'use strict';

  const VIRTUAL_DEVICE_ID = 'screenyard-virtual-camera';
  const VIRTUAL_DEVICE_LABEL = 'ScreenYard Virtual Camera';

  // ─── State ───
  let cachedStream = null; // MediaStream received from ScreenYard
  let pendingGetUserMedia = null; // Promise resolver for in-flight getUserMedia
  let pc = null; // RTCPeerConnection for receiving the stream

  // ─── Messaging with background ───
  // We use chrome.runtime.sendMessage to talk to the background SW,
  // which relays messages to the ScreenYard tab.
  function sendToBackground(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          resolve(response);
        });
      } catch (e) {
        // chrome.runtime might not be available in MAIN world
        // Fall back to postMessage bridge
        resolve(null);
      }
    });
  }

  // ─── WebRTC receiver: receive the canvas stream from ScreenYard tab ───
  async function setupWebRTCReceiver(offerSdp) {
    if (pc) {
      try { pc.close(); } catch (e) {}
      pc = null;
    }

    pc = new RTCPeerConnection({
      iceServers: [], // no STUN needed — loopback within same browser
    });

    // When we receive the track, store it
    pc.ontrack = (event) => {
      cachedStream = event.streams[0];
      if (pendingGetUserMedia) {
        pendingGetUserMedia(cachedStream);
        pendingGetUserMedia = null;
      }
    };

    // Set remote description (the offer from ScreenYard)
    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });

    // Create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Gather ICE candidates and send them back
    const iceCandidates = [];
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        iceCandidates.push(event.candidate.candidate);
      }
    };

    // Wait a brief moment for ICE gathering
    await new Promise((resolve) => setTimeout(resolve, 200));

    return {
      answer: pc.localDescription.sdp,
      iceCandidates,
    };
  }

  // ─── Listen for messages from background (relayed from ScreenYard) ───
  // In MAIN world we can't use chrome.runtime.onMessage directly,
  // so we use a CustomEvent bridge with the isolated world content script.
  // Actually, with "world": "MAIN", chrome APIs ARE available in MV3.
  // Let's use both approaches for robustness.

  // Approach 1: chrome.runtime.onMessage (works in MV3 MAIN world)
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'screenyard-webrtc-offer') {
        setupWebRTCReceiver(message.sdp)
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({ error: err.message }));
        return true; // async response
      }
      if (message.type === 'screenyard-ice-candidate') {
        if (pc && message.candidate) {
          pc.addIceCandidate({ candidate: message.candidate }).catch(() => {});
        }
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === 'screenyard-stream-status') {
        sendResponse({ active: !!cachedStream });
        return false;
      }
    });
  } catch (e) {
    console.warn('[ScreenYard] chrome.runtime.onMessage not available in MAIN world:', e);
  }

  // Approach 2: window event bridge (fallback)
  window.addEventListener('screenyard-webrtc-offer', async (event) => {
    try {
      const result = await setupWebRTCReceiver(event.detail.sdp);
      window.dispatchEvent(new CustomEvent('screenyard-webrtc-answer', { detail: result }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('screenyard-webrtc-answer', { detail: { error: err.message } }));
    }
  });

  // ─── Intercept navigator.mediaDevices ───
  const originalMediaDevices = navigator.mediaDevices;
  if (!originalMediaDevices) {
    console.warn('[ScreenYard] navigator.mediaDevices not available');
    return;
  }

  const originalEnumerateDevices = originalMediaDevices.enumerateDevices.bind(originalMediaDevices);
  const originalGetUserMedia = originalMediaDevices.getUserMedia.bind(originalMediaDevices);

  // Override enumerateDevices to add our virtual camera
  originalMediaDevices.enumerateDevices = async function () {
    const devices = await originalEnumerateDevices();

    // Check if our device is already in the list
    const exists = devices.some((d) => d.deviceId === VIRTUAL_DEVICE_ID);
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

  // Override getUserMedia to return our stream when the virtual camera is selected
  originalMediaDevices.getUserMedia = async function (constraints) {
    // Check if the caller is requesting our virtual camera
    const requestedDeviceId =
      constraints?.video?.deviceId?.exact ||
      constraints?.video?.deviceId?.ideal ||
      (typeof constraints?.video?.deviceId === 'string' ? constraints.video.deviceId : null);

    // Also check by label match (some apps use labels)
    const videoConstraints = constraints?.video;
    const isOurDevice =
      requestedDeviceId === VIRTUAL_DEVICE_ID ||
      (typeof videoConstraints === 'object' && videoConstraints?.label?.includes?.('ScreenYard'));

    if (isOurDevice) {
      // If we already have a cached stream, return it
      if (cachedStream && cachedStream.active) {
        return cachedStream;
      }

      // Request the stream from ScreenYard via WebRTC
      // Ask background to tell ScreenYard to start sending
      await sendToBackground({ type: 'screenyard-request-stream' });

      // Wait for the stream to arrive
      const stream = await new Promise((resolve, reject) => {
        pendingGetUserMedia = resolve;
        // Timeout after 10 seconds
        setTimeout(() => {
          if (pendingGetUserMedia) {
            pendingGetUserMedia = null;
            reject(new Error('ScreenYard Virtual Camera: timed out waiting for stream. Make sure ScreenYard is open and VCam mode is enabled.'));
          }
        }, 10000);
      });

      return stream;
    }

    // Normal camera request — pass through
    return originalGetUserMedia(constraints);
  };

  // Also override the deprecated callback version if it exists
  if (originalMediaDevices.getUserMedia.length === 3) {
    // Some browsers support the old callback API
    // We already overrode the promise version above
  }

  // ─── Also intercept the deprecated navigator.getUserMedia if present ───
  if (navigator.getUserMedia) {
    const originalNavGetUserMedia = navigator.getUserMedia.bind(navigator);
    navigator.getUserMedia = function (constraints, success, error) {
      const requestedDeviceId = constraints?.video?.optional?.find?.((o) => o.sourceId)?.sourceId;
      if (requestedDeviceId === VIRTUAL_DEVICE_ID) {
        originalMediaDevices.getUserMedia(constraints).then(success).catch(error);
      } else {
        originalNavGetUserMedia(constraints, success, error);
      }
    };
  }

  // ─── Dispatch devicechange event so sites pick up the new device ───
  setTimeout(() => {
    try {
      originalMediaDevices.dispatchEvent(new Event('devicechange'));
    } catch (e) {}
  }, 1000);

  console.log('[ScreenYard] Virtual camera injected. "ScreenYard Virtual Camera" will appear in camera settings.');
})();
