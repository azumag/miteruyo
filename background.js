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
  const channels = (await chrome.storage.sync.get('channels')).channels;
  for (const channel of channels) {
    console.log(channel);
    await checkStream(channel);
  }
  for (const channel of channels) {
    await saveChannel(channel);
  }
  if (isEnabled) {
    if (isOpenMultiTwitch) {
      channelQueuedStreamsInMultiTwitch();
    } else {
      channelQueuedStreams();
    }
  } else {
    channelQueue = [];
  };
}

async function channelQueuedStreamsInMultiTwitch() {
}

async function channelQueuedStreams() {
  if (isOpenNewWindow) {
    while (channelQueue.length > 0) {
      const firstChannel = channelQueue.shift();
      if (!firstChannel.onLive) continue;

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

async function checkStream(channel) {
  const url = `https://api.twitch.tv/helix/streams?user_login=${channel.name}`;
  const options = {
    headers: {
      'Client-ID': clientId,
      'Accept': 'application/vnd.twitchtv.v5+json',
      "Authorization": "Bearer " + oauth_token.oauth_token,
    },
  };

  const response = await fetch(url, options);
  const data = await response.json();

  if (data.data.length > 0) {
    console.log("online", data.data[0]);
    channel.onLive = true;
  } else {
    console.log("offline", channel.name);
    channel.onLive = false;
  }
  channelQueue.push(channel);
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
  if (!channel.onLive) return;
  const targetURL = channelURL(channel);
  chrome.tabs.query({}, tabs => {
    const matchingTabs = tabs.filter(tab => tab.url === targetURL);

    if (matchingTabs.length === 0) {
      chrome.tabs.create({ url: targetURL, windowId });
    }
  });
}

setInterval(checkStreams, 60 * 1000);
