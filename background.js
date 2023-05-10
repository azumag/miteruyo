const twitchDomain = 'https://www.twitch.tv';
const multiTwitchURL = 'https://www.multitwitch.tv/'
// const clientId = 'vzlsgu6bdv9tbad1uroc9v8tz813cx'; // for prod
const clientId = 'lt060jwpltwp3weqdk53dx450aj99p';

chrome.alarms.create("check-streams", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(function (alarm) {
  console.log(alarm);
  if (alarm.name === "check-streams") {
    checkStreams();
  }
});

async function checkStreams() {
  console.log('checkStreams');
  const isEnabled = (await chrome.storage.sync.get("isEnabled")).isEnabled;
  const isOpenMultiTwitch = (await chrome.storage.sync.get("isOpenMultiTwitch")).isOpenMultiTwitch;

  if (!isEnabled) return;
  const channels = (await chrome.storage.sync.get('channels')).channels;
  const oauth_token = (await chrome.storage.sync.get("oauth_token")).oauth_token;

  for (const channel of channels) {
    await checkStream(channel, oauth_token);
    console.log(channel);
  }

  for (const channel of channels) {
    await saveChannel(channel);
  }

  if (isOpenMultiTwitch) {
    channelQueuedStreamsInMultiTwitch();
  } else {
    channelQueuedStreams(channels);
  }
}

async function channelQueuedStreamsInMultiTwitch() {
}

async function channelQueuedStreams(channelQueue) {
  const isOpenNewWindow = (await chrome.storage.sync.get("isOpenNewWindow")).isOpenNewWindow;
  console.log('channelQueueStreams', { isOpenNewWindow });
  if (isOpenNewWindow) {
    const lastOpenWindowId = (await chrome.storage.sync.get("lastOpenWindowId")).lastOpenWindowId;
    for (const channel of channelQueue) {
      if (channel.onLive && channel.onLiveOpen) {
        if (lastOpenWindowId && await checkWindowExists(lastOpenWindowId)) {
          openTabIfNotExists(channel, lastOpenWindowId);
        } else {
          const tabs = await chrome.tabs.query({});
          const targetURL = channelURL(channel);
          const matchingTabs = tabs.filter(tab => tab.url === targetURL);
          if (matchingTabs.length === 0) {
            const newWindow = await chrome.windows.create({ url: targetURL });
            await chrome.storage.sync.set({ lastOpenWindowId: newWindow.id });
          }
        }
      }
    }
  } else {
    for (const channel of channelQueue) {
      if (channel.onLive && channel.onLiveOpen) {
        openTabIfNotExists(channel);
      }
    }
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
  const targetURL = channelURL(channel);
  chrome.tabs.query({}, tabs => {
    const matchingTabs = tabs.filter(tab => tab.url === targetURL);

    if (matchingTabs.length === 0) {
      chrome.tabs.create({ url: targetURL, windowId });
    }
  });
}

async function checkStream(channel, oauth_token) {
  const url = `https://api.twitch.tv/helix/streams?user_login=${channel.name}`;
  const options = {
    headers: {
      'Client-ID': clientId, 'Accept': 'application/vnd.twitchtv.v5+json',
      "Authorization": "Bearer " + oauth_token.oauth_token,
    },
  };

  const response = await fetch(url, options);
  const data = await response.json();

  if (data.data.length > 0) {
    console.log("online", data.data[0]);
    const stream = data.data[0];
    channel.onLive = true;
    channel.game_name = stream.game_name;
    channel.tags = stream.tags;
    channel.title = stream.title;
    channel.viewer_count = stream.viewer_count;
  } else {
    console.log("offline", channel.name);
    channel.onLive = false;
  }
  return channel;
}
