const loading = document.getElementById("loading");
const channelInput = document.getElementById("channelInput");
const addChannelBtn = document.getElementById("addChannelBtn");
const channelTable = document.getElementById("channelTableBody");
const enableSwitch = document.getElementById("enableSwitch");
const openNewWindow = document.getElementById("openNewWindow");
const openMultiTwitch = document.getElementById("openMultiTwitch");
const loginTwitch = document.getElementById("loginTwitch");
const openAll = document.getElementById("openAll");
const openMultiTwitchButton = document.getElementById("openMultiTwitchButton");
const openAllChecked = document.getElementById("openAllCheck");
const openCheckedMultiTwitchButton = document.getElementById("openCheckedMultiTwitchButton");

openMultiTwitch.hidden = true;

const twitchDomain = 'https://www.twitch.tv';
const clientId = 'vzlsgu6bdv9tbad1uroc9v8tz813cx';

chrome.storage.sync.get(
  {
    channels: [],
    isEnabled: false,
    isOpenNewWindow: false,
    isOpenMultiTwitch: false,
    oauth_token: null
  },
  async (data) => {
    loading.hidden = false;
    if (data.oauth_token) {
      const connected = await checkTwitchConnection(data.oauth_token);
      if (connected) {
        const checkStreams = [];
        for (const _channel of data.channels) {
          checkStreams.push(
            checkStream(_channel)
              .then((channel) => {
                if (channel) {
                  addChannelToList(channel);
                  return channel;
                }
              })
          );
        }
        Promise.all(checkStreams).then((channels) => {
          chrome.storage.sync.set({ channels });
        })
      }
    } else {
      rewriteNeedsLoginButton(false);
    }
    enableSwitch.checked = data.isEnabled;
    openNewWindow.checked = data.isOpenNewWindow;
    openMultiTwitch.checked = data.isOpenMultiTwitch;
    loading.hidden = true;
  }
);

async function addChannelToList(channel) {
  const tr = document.createElement('tr');
  tr.classList.add('channel-tr');

  const liveStatus = document.createElement('td');
  tr.appendChild(liveStatus);

  if (channel.onLive) {
    const openButton = document.createElement('button');
    liveStatus.appendChild(openButton);
    openButton.textContent = 'Live';
    openButton.setAttribute('class', 'btn btn-outline-success btn-sm');
    openButton.addEventListener('click', (event) => {
      chrome.tabs.create({ url: twitchDomain + "/" + channel.name });
    });
  }

  const onliveswitchtd = document.createElement('td');
  const onLiveOpenSwitch = document.createElement('input');
  onLiveOpenSwitch.setAttribute('class', 'text-center align-middle form-check-input mt-0')
  onLiveOpenSwitch.type = 'checkbox';
  onLiveOpenSwitch.checked = channel.onLiveOpen;
  onLiveOpenSwitch.addEventListener('change', () => {
    channel.onLiveOpen = onLiveOpenSwitch.checked;
    chrome.storage.sync.get('channels', (data) => {
      const newChannels = data.channels.filter((c) => c.name !== channel.name);

      chrome.storage.sync.set({ channels: [...newChannels, channel] });
    });
  });
  onliveswitchtd.appendChild(onLiveOpenSwitch);
  tr.appendChild(onliveswitchtd);

  const cntd = document.createElement('td');
  const channelNameTag = document.createElement('span');
  channelNameTag.textContent = channel.name;
  cntd.appendChild(channelNameTag);
  // if (channel.onLive && channel.title) {
  //   const desc = document.createElement('div');
  //   desc.textContent = channel.title;
  //   cntd.appendChild(desc);
  // }
  tr.appendChild(cntd);
  
  const categoriesInput = document.createElement('input');
  categoriesInput.id = channel.name + '|category';
  categoriesInput.type = 'text';
  categoriesInput.placeholder = 'category';
  categoriesInput.value = channel.categoriesFilter;
  // li.appendChild(categoriesInput);
  
  const tagsInput = document.createElement('input');
  tagsInput.id = channel.name + '|tag';
  tagsInput.type = 'text';
  tagsInput.placeholder = 'tag';
  tagsInput.value = channel.tagsFilter;
  // li.appendChild(tagsInput);

  const saveButton = document.createElement('button');
  saveButton.setAttribute('data-id', channel.name);
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', (event) => {
    const targetButton = event.target;
    const targetChannelName = targetButton.getAttribute('data-id');
    const targetChannel = {
      name: targetChannelName,
    };

    const categoriesInput = document.getElementById(targetChannelName+'|category');
    const tagsInput = document.getElementById(targetChannelName+'|tag');

    targetChannel.categoriesFilter = categoriesInput.value;
    targetChannel.tagsFilter = tagsInput.value;

    saveChannelToList(targetChannel);
  });
  // li.appendChild(saveButton);

  const removetd = document.createElement('td');
  const removeButton = document.createElement('i');
  removeButton.setAttribute('class', 'bi bi-trash')
  // const removeButton = document.createElement('button');
  // removeButton.textContent = 'DEL';
  removeButton.addEventListener('click', () => {
    tr.remove();
    removeChannel(channel);
  });
  removetd.appendChild(removeButton);
  tr.appendChild(removetd);

  channelTable.appendChild(tr);
}

function removeChannel(channel) {
  chrome.storage.sync.get('channels', (data) => {
    const newChannels = data.channels.filter((c) => c.name !== channel.name);
    chrome.storage.sync.set({ channels: newChannels });
  });
}

addChannelBtn.addEventListener("click", async () => {
  const channel = {
    name: channelInput.value.trim(),
    categoriesFilter: '',
    tagsFilter: ''
  }

  if (!channel.name) return;
  if (await duplicatedChannel(channel)) return;

  // Add the new channel to the list
  addChannelToList(channel);

  // Save the new channel to storage
  saveChannelToList(channel);
  
  // Clear the input field
  channelInput.value = "";
});

async function duplicatedChannel(channel) {
  const data = await chrome.storage.sync.get("channels");
  return (data.channels.findIndex((c) => c.name === channel.name) !== -1);
}

function saveChannelToList(channel) {
  chrome.storage.sync.get("channels", (data) => {
    if (Object.keys(data).length === 0) {
      const newChannels = [channel];
      chrome.storage.sync.set({ channels: newChannels });
    } else {
      const index = data.channels.findIndex((c) => c.name === channel.name);

      if (index !== -1) {
        data.channels.splice(index, 1);
      }

      const newChannels = [...data.channels, channel];
      chrome.storage.sync.set({ channels: newChannels });
    }
  });
}

enableSwitch.addEventListener("change", () => {
  chrome.storage.sync.set({ isEnabled: enableSwitch.checked });
});

openNewWindow.addEventListener("change", () => {
  chrome.storage.sync.set({ isOpenNewWindow: openNewWindow.checked });
});

openMultiTwitch.addEventListener("change", () => {
  chrome.storage.sync.set({ isOpenMultiTwitch: openMultiTwitch.checked });
});

openAll.addEventListener("click", async () => {
  const channels = (await chrome.storage.sync.get('channels')).channels;
  channels.forEach(channel => {
    if (channel.onLive) {
      const url = twitchDomain + '/' + channel.name;
      chrome.tabs.create({ url });
    }
  });
});

openMultiTwitchButton.addEventListener("click", async () => {
  const channels = (await chrome.storage.sync.get('channels')).channels;
  let url = 'https://www.multitwitch.tv/'
  channels.forEach(channel => {
    if (channel.onLive) {
      url += channel.name + "/";
    }
  });
  chrome.tabs.create({ url });
});

openAllChecked.addEventListener("click", async () => {
  const channels = (await chrome.storage.sync.get('channels')).channels;
  channels.forEach(channel => {
    if (channel.onLive && channel.onLiveOpen) {
      const url = twitchDomain + '/' + channel.name;
      chrome.tabs.create({ url });
    }
  });
});

openCheckedMultiTwitchButton.addEventListener("click", async () => {
  const channels = (await chrome.storage.sync.get('channels')).channels;
  let url = 'https://www.multitwitch.tv/'
  channels.forEach(channel => {
    if (channel.onLive && channel.onLiveOpen) {
      url += channel.name + "/";
    }
  });
  chrome.tabs.create({ url });
});

loginTwitch.addEventListener("click", () => {
  console.log(chrome.identity.getRedirectURL());
  chrome.identity.launchWebAuthFlow({
    url: `https://id.twitch.tv/oauth2/authorize?` +
      `client_id=vzlsgu6bdv9tbad1uroc9v8tz813cx&` +
      `redirect_uri=${chrome.identity.getRedirectURL()}&` +
      `response_type=token&` +
      `scope=user:read:email`,
    interactive: true
  }, responseUrl => {
    console.log({ responseUrl });
    if (responseUrl) {
      let hash = new URL(responseUrl).hash;
      let result = parseHashToObj(hash);
      let oauth_token = { oauth_token: result.access_token };
      chrome.storage.sync.set({ oauth_token });
      checkTwitchConnection(oauth_token);
      console.log(oauth_token);
    } else {
      console.error("Invalid response URL:", responseUrl);
      loginTwitch.text = 'login fail: please login twitch';
      loginTwitch.enable = true;
    }
  });
});

function parseHashToObj(hash) {
  return hash.replace("#", "").split('&').reduce((res, item) => {
    const parts = item.split('=');
    res[parts[0]] = parts[1];
    return res;
  }, {});
}

function checkTwitchConnection(oauthToken) {
  console.log('checkTwitch');
  const token = oauthToken.oauth_token;
  var url = "https://api.twitch.tv/helix/users?login=azumagbanjo";
  var headers = {
    "Client-Id": 'vzlsgu6bdv9tbad1uroc9v8tz813cx',
    "Authorization": "Bearer " + token,
  };
  var options = {
    "method": "GET",
    "headers": headers,
  };
  return fetch(url, options)
    .then(response => {
      console.log(response);
      rewriteNeedsLoginButton(response.ok)
      return true;
    })
    .catch(error => {
      console.error(error);
      rewriteNeedsLoginButton(false);
      return false;
    });
}

function rewriteNeedsLoginButton(isOk) {
  const mainElements = document.getElementById("main");
  if (isOk) {
    loginTwitch.textContent = 'connected';
  } else {
    loginTwitch.textContent = 'please login twitch';
  }
  loginTwitch.disabled = isOk;
  mainElements.hidden = !isOk;
}

async function checkStream(channel) {
  const oauth_token = (await chrome.storage.sync.get("oauth_token")).oauth_token;

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

  if (data.data === undefined) {
    removeChannel(channel);
    return;
  }

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

async function saveChannel(channel) {
  const channels = (await chrome.storage.sync.get('channels')).channels;
  const index = channels.findIndex((c) => c.name === channel.name);

  if (index !== -1) {
    channels.splice(index, 1);
  }

  const newChannels = [...channels, channel];
  await chrome.storage.sync.set({ channels: newChannels });
}
