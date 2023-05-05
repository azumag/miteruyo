let isEnabled = false;
let channels = [];
let oauth_token;

const clientId = 'vzlsgu6bdv9tbad1uroc9v8tz813cx';

chrome.storage.sync.get(["isEnabled", "channels", "oauth_token"], function (data) {
  isEnabled = data.isEnabled;
  channels = data.channels;
  oauth_token = data.oauth_token;
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
});

function checkStreams() {
  if (!isEnabled) return;
  channels.forEach((channel) => {
    console.log(channel);
    checkStream(channel);
  })
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
    console.log("online", data.data);
  } else {
    console.log("offline", channel.name);
  }
}

// Check streams every minute.
setInterval(checkStreams, 60 * 1000);
