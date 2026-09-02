/**
 * ScreenYard — Background Service Worker
 *
 * Coordinates communication between:
 * - ScreenYard tab (the app with the canvas stream)
 * - Video call tabs (Meet, Zoom, Teams, etc. with the content script)
 *
 * Message flow:
 * 1. Content script → "screenyard-request-stream" → background
 * 2. Background → "screenyard-start-webrtc" → ScreenYard tab
 * 3. ScreenYard creates RTCPeerConnection, sends offer
 * 4. ScreenYard → "screenyard-webrtc-offer" → background
 * 5. Background → "screenyard-webrtc-offer" → content script (caller tab)
 * 6. Content script creates answer, sends it back
 * 7. Content script → "content-webrtc-answer" → background
 * 8. Background → "content-webrtc-answer" → ScreenYard tab
 * 9. ICE candidates exchanged bidirectionally
 * 10. Stream flows from ScreenYard → content script → getUserMedia → video call
 */

// Track the ScreenYard tab
let screenyardTabId = null;

// Track which caller tab is waiting for an offer response
let pendingCallerTabId = null;

// Open ScreenYard when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }, (tab) => {
    screenyardTabId = tab.id;
  });
});

// Track which tab is ScreenYard
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.startsWith(chrome.runtime.getURL(''))) {
    screenyardTabId = tabId;
  }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === screenyardTabId) {
    screenyardTabId = null;
    // Notify all video call tabs that ScreenYard is gone
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.url && isVideoCallUrl(tab.url)) {
          chrome.tabs.sendMessage(tab.id, { type: 'screenyard-disconnected' }).catch(() => {});
        }
      }
    });
  }
});

function isVideoCallUrl(url) {
  const patterns = [
    'meet.google.com',
    'zoom.us',
    'teams.microsoft.com',
    'teams.live.com',
    'webex.com',
    'discord.com',
    'slack.com',
    'whereby.com',
    'jitsi.org',
    '8x8.vc',
  ];
  return patterns.some((p) => url.includes(p));
}

// Main message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ─── From ScreenYard tab: register as the stream source ───
  if (message.type === 'screenyard-register') {
    screenyardTabId = sender.tab?.id || null;
    sendResponse({ ok: true });
    return false;
  }

  // ─── From ScreenYard tab: stream is ready ───
  if (message.type === 'screenyard-stream-ready') {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.url && isVideoCallUrl(tab.url)) {
          chrome.tabs.sendMessage(tab.id, { type: 'screenyard-stream-available' }).catch(() => {});
        }
      }
    });
    sendResponse({ ok: true });
    return false;
  }

  // ─── From ScreenYard tab: stream stopped ───
  if (message.type === 'screenyard-stream-stopped') {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.url && isVideoCallUrl(tab.url)) {
          chrome.tabs.sendMessage(tab.id, { type: 'screenyard-disconnected' }).catch(() => {});
        }
      }
    });
    return false;
  }

  // ─── From content script (video call tab): request stream ───
  if (message.type === 'screenyard-request-stream') {
    if (!screenyardTabId) {
      sendResponse({ error: 'ScreenYard tab is not open. Click the extension icon to open it.' });
      return false;
    }
    pendingCallerTabId = sender.tab?.id;
    // Forward request to ScreenYard tab — it will create an offer and send it back
    chrome.tabs.sendMessage(screenyardTabId, {
      type: 'screenyard-start-webrtc',
      callerTabId: sender.tab?.id,
    }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: 'ScreenYard tab is not responding: ' + chrome.runtime.lastError.message });
      } else {
        sendResponse(response);
      }
    });
    return true; // async
  }

  // ─── From ScreenYard tab: WebRTC offer for a specific caller ───
  if (message.type === 'screenyard-webrtc-offer') {
    const callerTabId = message.callerTabId || pendingCallerTabId;
    if (callerTabId) {
      chrome.tabs.sendMessage(callerTabId, {
        type: 'screenyard-webrtc-offer',
        sdp: message.sdp,
      }).catch(() => {
        console.warn('[ScreenYard BG] Failed to send offer to caller tab', callerTabId);
      });
    }
    sendResponse({ ok: true });
    return false;
  }

  // ─── From ScreenYard tab: ICE candidate for caller ───
  if (message.type === 'screenyard-ice-candidate') {
    const callerTabId = message.callerTabId || pendingCallerTabId;
    if (callerTabId) {
      chrome.tabs.sendMessage(callerTabId, {
        type: 'screenyard-ice-candidate',
        candidate: message.candidate,
      }).catch(() => {});
    }
    return false;
  }

  // ─── From content script: WebRTC answer for ScreenYard ───
  if (message.type === 'content-webrtc-answer') {
    if (screenyardTabId) {
      chrome.tabs.sendMessage(screenyardTabId, {
        type: 'content-webrtc-answer',
        answer: message.answer,
      }).catch(() => {});
    }
    return false;
  }

  // ─── From content script: ICE candidates for ScreenYard ───
  if (message.type === 'content-ice-candidate') {
    if (screenyardTabId) {
      chrome.tabs.sendMessage(screenyardTabId, {
        type: 'content-ice-candidate',
        candidates: message.candidates,
      }).catch(() => {});
    }
    return false;
  }

  // ─── Ping: check if ScreenYard is active ───
  if (message.type === 'screenyard-ping') {
    sendResponse({
      active: !!screenyardTabId,
      tabId: screenyardTabId,
    });
    return false;
  }

  return false;
});
