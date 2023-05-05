const channelInput = document.getElementById("channelInput");
const addChannelBtn = document.getElementById("addChannelBtn");
const channelListItems = document.getElementById("channelListItems");
const enableSwitch = document.getElementById("enableSwitch");
const loginTwitch = document.getElementById("loginTwitch");

// Load the saved values from storage and display them in the UI
chrome.storage.sync.get(
  {
    channels: [],
    isEnabled: false,
  },
  (data) => {
    console.log(data.channels);
    data.channels.forEach((channel) => addChannelToList(channel));
    enableSwitch.checked = data.isEnabled;
  }
);

chrome.storage.sync.get("oauth_token", (data) => {
  console.log(data);
  if (data.oauth_token) {
    checkTwitchConnection(data.oauth_token);
  } else {
    rewriteNeedsLoginButton(false);
  }
});

function addChannelToList(channel) {
  const li = document.createElement('li');
  li.classList.add('channel-item');
  
  const channelNameTag = document.createElement('span');
  channelNameTag.textContent = channel.name;
  li.appendChild(channelNameTag);
  
  const categoriesInput = document.createElement('input');
  categoriesInput.id = channel.name + '|category';
  categoriesInput.type = 'text';
  categoriesInput.placeholder = 'category';
  categoriesInput.value = channel.categoriesFilter;
  li.appendChild(categoriesInput);
  
  const tagsInput = document.createElement('input');
  tagsInput.id = channel.name + '|tag';
  tagsInput.type = 'text';
  tagsInput.placeholder = 'tag';
  tagsInput.value = channel.tagsFilter;
  li.appendChild(tagsInput);

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
  li.appendChild(saveButton);

  const removeButton = document.createElement('button');
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => {
    li.remove();

    chrome.storage.sync.get('channels', (data) => {
      const newChannels = data.channels.filter((c) => c.name !== channel.name);
      chrome.storage.sync.set({ channels: newChannels });
    });
  });
  li.appendChild(removeButton);

  channelListItems.appendChild(li);
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
  // Save the current state of the switch to storage
  chrome.storage.sync.set({ isEnabled: enableSwitch.checked });
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
    })
    .catch(error => {
      console.error(error);
      rewriteNeedsLoginButton(false);
    });
}

function rewriteNeedsLoginButton(isOk) {
  if (isOk) {
    loginTwitch.textContent = 'connected';
  } else {
    loginTwitch.textContent = 'please login twitch';
  }
  loginTwitch.disabled = isOk;
}
