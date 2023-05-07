importScripts('common.js');

let isEnabled = false;
let isOpenNewWindow = false;
let isOpenMultiTwitch = false;
let oauth_token;
let channelQueue = [];
let lastOpenWindowId;

const twitchDomain = 'https://www.twitch.tv';
const multiTwitchURL = 'https://www.multitwitch.tv/'
const clientId = 'vzlsgu6bdv9tbad1uroc9v8tz813cx';

chrome.storage.sync.get(["isEnabled", "oauth_token", "isOpenNewWindow"], function (data) {
  isEnabled = data.isEnabled;
  oauth_token = data.oauth_token;
  isOpenNewWindow = data.isOpenNewWindow;
  isOpenMultiTwitch = data.isOpenMultiTwitch;
});

chrome.storage.onChanged.addListener(function(changes) {
  if (changes.isEnabled) {
    isEnabled = changes.isEnabled.newValue;
    console.log(isEnabled);
  }
  if (changes.oauth_token) {
    oauth_token = changes.oauth_token.newValue;
  }
  if (changes.isOpenNewWindow) {
    isOpenNewWindow = changes.isOpenNewWindow.newValue;
  }
  if (changes.isOpenMultiTwitch) {
    isOpenMultiTwitch = changes.isOpenMultiTwitch.newValue;
  }
});

async function checkStreams() {
  if (!isEnabled) return;
  const channels = (await chrome.storage.sync.get('channels')).channels;
  for (const channel of channels) {
    console.log(channel);
    const queueChannel = await checkStream(channel);
    channelQueue.push(queueChannel);
  }
  for (const channel of channelQueue) {
    await saveChannel(channel);
  }
  if (isOpenMultiTwitch) {
    channelQueuedStreamsInMultiTwitch();
  } else {
    channelQueuedStreams();
  }
}

async function channelQueuedStreamsInMultiTwitch() {
}

async function channelQueuedStreams() {
  if (isOpenNewWindow) {
    while (channelQueue.length > 0) {
      const firstChannel = channelQueue.shift();
      if (!firstChannel.onLive || !firstChannel.onLiveOpen) continue;

      const tabs = await chrome.tabs.query({});
      const targetURL = channelURL(firstChannel);
      const matchingTabs = tabs.filter(tab => tab.url === targetURL);

      if (matchingTabs.length === 0) {
        let windowId;
        if (lastOpenWindowId && await checkWindowExists(lastOpenWindowId)) {
          windowId = lastOpenWindowId;
        } else {
          const newWindow = await chrome.windows.create({ url: targetURL });
          windowId = newWindow.id
        }
        lastOpenWindowId = windowId;

        console.log({ channelQueue });
        channelQueue.forEach(channel => {
          openTabIfNotExists(channel, windowId);
        });
        channelQueue = [];
      }
    }
  } else {
    channelQueue.forEach(channel => {
      openTabIfNotExists(channel);
    });
    channelQueue = [];
  }
}

function channelURL(channel) {
  return twitchDomain + '/' + channel.name;
}

async function checkWindowExists(windowId) {
  return new Promise((resolve) => {
    chrome.windows.get(windowId, { populate: false }, (window) => {
      if (chrome.runtime.lastError) {
        // Window not found
        resolve(false);
      } else {
        // Window found
        resolve(true);
      }
    });
  });
}

async function saveChannel(channel) {
  const channels = (await chrome.storage.sync.get('channels')).channels;
  const index = channels.findIndex((c) => c.name === channel.name);

  if (index !== -1) {
    channels.splice(index, 1);
  }

  const newChannels = [...channels, channel];
  await chrome.storage.sync.set({ channels: newChannels });
}

function openTabIfNotExists(channel, windowId = null) {
  if (!channel.onLive || !channel.onLiveOpen) return;
  const targetURL = channelURL(channel);
  chrome.tabs.query({}, tabs => {
    const matchingTabs = tabs.filter(tab => tab.url === targetURL);

    if (matchingTabs.length === 0) {
      chrome.tabs.create({ url: targetURL, windowId });
    }
  });
}

setInterval(checkStreams, 60 * 1000);
