let isEnabled = false;
let filterCategory = "";
let filterTags = "";

chrome.storage.sync.get(["isEnabled", "filterCategory", "filterTags"], function(data) {
  isEnabled = data.isEnabled;
  filterCategory = data.filterCategory;
  filterTags = data.filterTags;
});

chrome.storage.onChanged.addListener(function(changes) {
  if (changes.isEnabled) {
    isEnabled = changes.isEnabled.newValue;
  }
  if (changes.filterCategory) {
    filterCategory = changes.filterCategory.newValue;
  }
  if (changes.filterTags) {
    filterTags = changes.filterTags.newValue;
  }
});

chrome.storage.sync.get(
  {
    isEnabled: false,
    filterCategory: "",
    filterTags: "",
  },
  function (data) {
    isEnabled = data.isEnabled;
		filterCategory = data.filterCategory;
    filterTags = data.filterTags;
  }
);

function checkStreams() {
  if (!isEnabled) return;

  // 1. Fetch registered channels.
  // 2. Use Twitch API to check their streaming status.
  // 3. Filter channels based on category and tags.
  // 4. Open a new tab or window for each channel that started streaming.
}

async function openOnlineStream(channelName) {
  const settings = await chrome.storage.sync.get(["clientId", "accessToken"]);
  const clientId = settings.clientId;
  const accessToken = settings.accessToken;

  const userId = await getUserId(clientId, accessToken, channelName);
  const requestUrl = `https://api.twitch.tv/helix/streams?user_id=${userId}`;
  const response = await fetch(requestUrl, {
    headers: {
      "Client-ID": clientId,
      "Authorization": `Bearer ${accessToken}`
    }
  });
  const data = await response.json();

  if (data.data.length > 0) {
    // Stream is online
    console.log("online", channelName);
		const url = `https://wwww.twitch.tv/${channelName}`;
		chrome.tabs.create({ url });
    return true;
  } else {
    // offline
    return false;
  }
}

function getUserId(clientId, accessToken, username) {
  const requestUrl = `https://api.twitch.tv/helix/users?login=${username}`;

  return fetch(requestUrl, {
    headers: {
      "Client-ID": clientId,
      "Authorization": `Bearer ${accessToken}`
    }
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.data.length > 0) {
        return data.data[0].id;
      } else {
        throw new Error("User not found");
      }
    })
    .catch((error) => {
      console.error("Error fetching user ID:", error);
      console.error("username", username)
    });
}

// Check streams every minute.
setInterval(checkStreams, 60 * 1000);
