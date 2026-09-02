/**
 * ScreenYard — Background Service Worker
 *
 * Coordinates communication between:
 * - ScreenYard tab (the app with the canvas stream)
 * - Video call tabs (Meet, Zoom, Teams, etc. with the content script)
 *
 * When a video call tab requests the ScreenYard stream:
 * 1. Content script sends "screenyard-request-stream"
 * 2. Background forwards to ScreenYard tab
 * 3. ScreenYard creates RTCPeerConnection, adds canvas track, creates offer
 * 4. Background relays offer to content script
 * 5. Content script creates answer
 * 6. Background relays answer back to ScreenYard
 * 7. ICE candidates exchanged bidirectionally
 * 8. Stream flows from ScreenYard → content script → getUserMedia → video call
 */

// Track the ScreenYard tab
let screenyardTabId = null;

// Track pending stream requests from video call tabs
const pendingRequests = new Map(); // tabId → resolver

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
    // Notify all video call tabs that the stream is available
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

  // ─── From content script (video call tab): request stream ───
  if (message.type === 'screenyard-request-stream') {
    if (!screenyardTabId) {
      sendResponse({ error: 'ScreenYard tab is not open. Click the extension icon to open it.' });
      return false;
    }
    // Forward request to ScreenYard tab
    chrome.tabs.sendMessage(screenyardTabId, {
      type: 'screenyard-start-webrtc',
      callerTabId: sender.tab?.id,
    }, (response) => {
      sendResponse(response);
    });
    return true; // async
  }

  // ─── From ScreenYard tab: WebRTC offer for a specific caller ───
  if (message.type === 'screenyard-webrtc-offer') {
    const callerTabId = message.callerTabId;
    chrome.tabs.sendMessage(callerTabId, {
      type: 'screenyard-webrtc-offer',
      sdp: message.sdp,
    }, (response) => {
      // Relay the answer back to ScreenYard
      sendResponse(response);
    });
    return true; // async
  }

  // ─── From ScreenYard tab: ICE candidate for caller ───
  if (message.type === 'screenyard-ice-candidate') {
    const callerTabId = message.callerTabId;
    chrome.tabs.sendMessage(callerTabId, {
      type: 'screenyard-ice-candidate',
      candidate: message.candidate,
    }).catch(() => {});
    return false;
  }

  // ─── From content script: ICE candidate for ScreenYard ───
  if (message.type === 'content-ice-candidate') {
    if (screenyardTabId) {
      chrome.tabs.sendMessage(screenyardTabId, {
        type: 'content-ice-candidate',
        candidate: message.candidate,
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
