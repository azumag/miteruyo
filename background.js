let isEnabled = false;
let isOpenNewWindow = false;
let channels = [];
let oauth_token;
let openQueue = [];
let lastOpenWindowId;

const twitchDomain = 'https://www.twitch.tv';

const clientId = 'vzlsgu6bdv9tbad1uroc9v8tz813cx';

chrome.storage.sync.get(["isEnabled", "channels", "oauth_token", "isOpenNewWindow"], function (data) {
  isEnabled = data.isEnabled;
  channels = data.channels;
  oauth_token = data.oauth_token;
  isOpenNewWindow = data.isOpenNewWindow;
  console.log(channels);
});

chrome.storage.onChanged.addListener(function(changes) {
  if (changes.isEnabled) {
    isEnabled = changes.isEnabled.newValue;
    console.log(isEnabled);
  }
  if (changes.channels) {
    channels = changes.channels.newValue;
    console.log(channels);
  }
  if (changes.oauth_token) {
    oauth_token = changes.oauth_token.newValue;
  }
  if (changes.isOpenNewWindow) {
    isOpenNewWindow = changes.isOpenNewWindow.newValue;
  }
});

async function checkStreams() {
  if (!isEnabled) return;
  for (const channel of channels) {
    console.log(channel);
    await checkStream(channel);
  }
  openQueuedStreams();
}

async function openQueuedStreams() {
  console.log({ isOpenNewWindow });
  if (isOpenNewWindow) {
    while (openQueue.length > 0) {
      const firstUrl = openQueue.shift();
      const tabs = await chrome.tabs.query({});
      const matchingTabs = tabs.filter(tab => tab.url === firstUrl);

      if (matchingTabs.length === 0) {
        let windowId;
        if (lastOpenWindowId && await checkWindowExists(lastOpenWindowId)) {
          windowId = lastOpenWindowId;
        } else {
          const newWindow = await chrome.windows.create({ url: firstUrl });
          windowId = newWindow.id
        }
        lastOpenWindowId = windowId;

        openQueue.forEach(url => {
          openTabIfNotExists(url, windowId);
        });
        openQueue = [];
      }
    }
  } else {
    openQueue.forEach(url => {
      openTabIfNotExists(url);
    });
    openQueue = [];
  }
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

  console.log(data);
  if (data.data.length > 0) {
    console.log("online", data.data[0]);
    const targetURL = twitchDomain + '/' + channel.name;
    openQueue.push(targetURL);
  } else {
    console.log("offline", channel.name);
  }
}

function openTabIfNotExists(targetURL, windowId = null) {
  chrome.tabs.query({}, tabs => {
    const matchingTabs = tabs.filter(tab => tab.url === targetURL);

    if (matchingTabs.length === 0) {
      chrome.tabs.create({ url: targetURL, windowId });
    }
  });
}


// Check streams every minute.
setInterval(checkStreams, 6 * 1000);
