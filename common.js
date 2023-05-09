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
  return channel;
}

self.checkStream = checkStream;

