const twitchDomain = 'https://www.twitch.tv';
const multiTwitchURL = 'https://www.multitwitch.tv/'

// const clientId = 'vzlsgu6bdv9tbad1uroc9v8tz813cx'; // for prod
const clientId = 'lt060jwpltwp3weqdk53dx450aj99p';

chrome.alarms.create("periodicalUpdate", { periodInMinutes: 1 });

chrome.storage.local.get('tabRotateInterval', (data) => {
  if (data.tabRotationInterval) {
    const interval = parseInt(data.tabRotationInterval, 10);
    chrome.alarms.create("tabRotationAlarm", { periodInMinutes: interval });
  }
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === "periodicalUpdate") {
    checkStreams();
  }
  if (alarm.name === "tabRotationAlarm") {
    checkTabRotate();
  }
});

// tab Rotation Interval が変更されたときにアラームの間隔を更新
chrome.storage.onChanged.addListener((changes, namespace) => {
  for (let key in changes) {
    if (key === 'tabRotationInterval') {
      // アラームを一度削除
      chrome.alarms.clear("tabRotationAlarm");
      // 新しい間隔でアラームを作成
      const interval = parseInt(changes[key].newValue, 10);
      chrome.alarms.create("tabRotationAlarm", { periodInMinutes: interval });
    }
  }
});

chrome.tabs.onActivated.addListener(async activeInfo => {
  const targetWindowId = (await chrome.storage.local.get("lastOpenWindowId")).lastOpenWindowId;
  const enableTabMute = (await chrome.storage.local.get("isEnabledTabMute")).isEnabledTabMute;
  const enableAutoClose = (await chrome.storage.local.get("isEnabledAutoClose")).isEnabledAutoClose;

  if (activeInfo.windowId === targetWindowId) {
    console.log('activated', activeInfo, enableTabMute, enableAutoClose);
    if (enableTabMute) {
      // 一旦すべてのタブをミュートする
      chrome.tabs.query({ windowId: targetWindowId }, (tabs) => {
        tabs.forEach((tab) => {
          // アクティブタブのみミュートを解除する
          if (tab.id === activeInfo.tabId) {
            chrome.tabs.update(tab.id, { muted: false });
          } else {
            chrome.tabs.update(tab.id, { muted: true });
          };
        });
      });
    }
    
    // Apply volume setting for the activated tab
    applyVolumeSettingForActivatedTab(activeInfo.tabId);
    
    if (enableAutoClose) {
      if (await checkOfflineWithTab(activeInfo.tabId)) {
        console.log('close tab', activeInfo.tabId);
        chrome.tabs.remove(activeInfo.tabId);
      }
    }
  }
});

// Function to find and apply the appropriate volume setting for an activated tab
async function applyVolumeSettingForActivatedTab(tabId) {
  try {
    // Get tab URL
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url.includes("twitch.tv")) return; // Skip if not a Twitch tab
    
    // Extract channel name from URL
    const url = new URL(tab.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length === 0) return; // No channel name found
    
    const channelName = pathParts[0];
    
    // Find matching channel in storage
    const data = await chrome.storage.local.get('channels');
    if (!data.channels) return;
    
    const channel = data.channels.find(c => c.name === channelName);
    if (channel && channel.volume !== undefined) {
      applyVolumeSettingToTab(tabId, channel);
    }
  } catch (error) {
    console.error('Error in applyVolumeSettingForActivatedTab:', error);
  }
}

async function checkTabRotate() {
  const isEnabledTabRotation = (await chrome.storage.local.get("isEnabledTabRotation")).isEnabledTabRotation;
  const targetWindowId = (await chrome.storage.local.get("lastOpenWindowId")).lastOpenWindowId;
  if (!isEnabledTabRotation) return;
  if (!targetWindowId) return;

  const enableTabMute = (await chrome.storage.local.get("isEnabledTabMute")).isEnabledTabMute;

  chrome.windows.get(targetWindowId, (window) => {
    if (chrome.runtime.lastError) {
      // console.error(chrome.runtime.lastError);
      // Clear the targetWindowId if the window does not exist
      // chrome.storage.local.set({ targetWindowId: null });
    } else {
      // If the window exists, switch tabs
      chrome.tabs.query({ windowId: targetWindowId }, async (tabs) => {
        if (tabs.length > 1) {
          let currentTabIndex = tabs.findIndex((tab) => tab.active);
          let nextTabIndex = (currentTabIndex + 1) % tabs.length;

          chrome.tabs.update(tabs[currentTabIndex].id, { muted: enableTabMute });
          chrome.tabs.update(tabs[nextTabIndex].id, { active: true, muted: false });
          
          // Apply volume setting for the newly activated tab
          applyVolumeSettingForActivatedTab(tabs[nextTabIndex].id);

          // suspend previous tab
          // const suspendedUrl = "chrome-extension://" + chrome.runtime.id + "/suspended.html#" + encodeURIComponent(tabs[currentTabIndex].url);
          // chrome.tabs.update(tabs[currentTabIndex].id, { url: suspendedUrl });

          // Close duplicate tabs
          // タブURLからクエリパラメータを削除
          const urls = tabs.map(tab => {
            const url = new URL(tab.url);
            url.search = ''; // クエリパラメータを削除
            return url.toString();
          });

          // 重複しないURLを識別
          const uniqueUrls = [...new Set(urls)];

          // 最初に見つかったタブのみを保持し、重複するタブを削除
          const tabsToRemove = [];
          tabs = tabs.filter((tab, index) => {
            const url = new URL(tab.url);
            url.search = '';
            const urlString = url.toString();
            // URLが最初に登場する位置が現在のインデックスと異なる場合、これは重複タブと見なし削除リストに追加
            if (urls.indexOf(urlString) !== index) {
              tabsToRemove.push(tab);
              return false;
            }
            return true;
          });

          // 重複するタブを削除
          for (let i = 0; i < tabsToRemove.length; i++) {
            chrome.tabs.remove(tabsToRemove[i].id);
          }
        }
      });
    }
  });


}

async function checkStreams() {
  console.log('checkStreams');
  const isEnabled = (await chrome.storage.local.get("isEnabled")).isEnabled;
  const isOpenMultiTwitch = (await chrome.storage.local.get("isOpenMultiTwitch")).isOpenMultiTwitch;

  if (!isEnabled) return;
  const channels = (await chrome.storage.local.get('channels')).channels;
  const oauth_token = (await chrome.storage.local.get("oauth_token")).oauth_token;

  if (!oauth_token) {
    return;
  }

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
  const isOpenNewWindow = (await chrome.storage.local.get("isOpenNewWindow")).isOpenNewWindow;
  console.log('channelQueueStreams', { isOpenNewWindow });
  if (isOpenNewWindow) {
    const lastOpenWindowId = (await chrome.storage.local.get("lastOpenWindowId")).lastOpenWindowId;
    for (const channel of channelQueue) {
      if (channel.onLive && channel.onLiveOpen) {
        console.log('channelQueueStreams', { lastOpenWindowId });
        if (lastOpenWindowId && await checkWindowExists(lastOpenWindowId)) {
          openTabIfNotExists(channel, lastOpenWindowId);
        } else {
          const tabs = await chrome.tabs.query({});
          const targetURL = channelURL(channel);
          const matchingTabs = tabs.filter(tab => tab.url === targetURL);
          if (matchingTabs.length === 0) {
            console.log('openNewWindow', { targetURL, matchingTabs: matchingTabs.length });
            const newWindow = await chrome.windows.create({ url: targetURL });
            await chrome.storage.local.set({ lastOpenWindowId: newWindow.id });
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
  const channels = (await chrome.storage.local.get('channels')).channels;
  const index = channels.findIndex((c) => c.name === channel.name);

  if (index !== -1) {
    channels.splice(index, 1);
  }

  const newChannels = [...channels, channel];
  await chrome.storage.local.set({ channels: newChannels });
}

function openTabIfNotExists(channel, windowId = null) {
  const targetURL = channelURL(channel);
  console.log('openTabIfNotExists', { targetURL, windowId })
  chrome.tabs.query({}, tabs => {
    const matchingTabs = tabs.filter(tab => {
      // 既存のタブのURLからクエリパラメータを除去
      const tabURLWithoutQuery = new URL(tab.url);
      tabURLWithoutQuery.search = '';
      return tabURLWithoutQuery.toString() === targetURL; // クエリパラメータを除去したURLで比較
    });

    if (matchingTabs.length === 0) {
      chrome.tabs.create({ url: targetURL, windowId }, (tab) => {
        // Apply volume setting when tab is created
        applyVolumeSettingToTab(tab.id, channel);
      });
    } else {
      // Apply volume setting to existing tab
      applyVolumeSettingToTab(matchingTabs[0].id, channel);
    }
  });
}

// Function to apply volume setting to a specific tab
async function applyVolumeSettingToTab(tabId, channel) {
  // Only apply if the channel has a volume setting
  if (channel.volume !== undefined) {
    try {
      // Wait a moment to let the page load before injecting
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          action: 'setVolume',
          volume: channel.volume
        }, (response) => {
          // Handle any errors with message sending (e.g., content script not yet loaded)
          if (chrome.runtime.lastError) {
            console.log('Will inject content script first');
            // If the content script isn't loaded, inject it and try again
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['contentScript.js']
            }).then(() => {
              // Try sending the message again after script is injected
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, {
                  action: 'setVolume',
                  volume: channel.volume
                });
              }, 500);
            }).catch(err => console.error('Error injecting content script:', err));
          }
        });
      }, 1000);
    } catch (error) {
      console.error('Error applying volume setting:', error);
    }
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
      // console.log(data);
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

async function getTabUrl(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return tab.url;
}

async function checkOfflineWithTab(tabId) {
  // タブのURLを取得する
  const tabUrl = (await getTabUrl(tabId));

  console.log('check offline', tabUrl);
  if (!tabUrl.includes("twitch")) {
    console.log('tab is not twitch', tabUrl);
    return;
  }

  let channelName;
  const splittedUrl = tabUrl.split("/");
  channelName = splittedUrl[splittedUrl.length - 1].split("?")[0];
  console.log('channelName', channelName);

  const accessToken = (await chrome.storage.local.get("oauth_token")).oauth_token.oauth_token;

  if (!accessToken) {
    return;
  }

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
    // online
    return false;
  } else {
    // offline
    return true;
  }
}

async function checkStream(channel, oauth_token) {
  if (!channel) return;

  const url = `https://api.twitch.tv/helix/streams?user_login=${channel.name}`;
  const options = {
    headers: {
      'Client-ID': clientId, 'Accept': 'application/vnd.twitchtv.v5+json',
      "Authorization": "Bearer " + oauth_token.oauth_token,
    },
  };

  const response = await fetch(url, options);
  const data = await response.json();

  if (data.data === undefined) {
    channel.status = 'error';
    return channel;
  }

  if (data.data.length > 0) {
    console.log("online", data.data[0]);
    const stream = data.data[0];
    channel.onLive = true;
    channel.game_name = stream.game_name;
    channel.tags = stream.tags;
    channel.title = stream.title;
    channel.viewer_count = stream.viewer_count;
    channel.status = 'online';
  } else {
    console.log("offline", channel.name);
    channel.onLive = false;
    channel.status = 'offline';
  }
  return channel;
}

// アップデート時に旧データがある場合のみデータを引き継ぐ
// 引き継ぎ後は share のデータを削除
// chrome.runtime.onInstalled.addListener((details) => {
//   if (details.reason === 'update') {
//     // アップデート時に既存の設定を取得
//     chrome.storage.sync.get(null, (data) => {
//       if (Object.keys(data).length > 0) { // データが存在する場合
//         // 新しいデータストレージ形式にデータを移行
//         chrome.storage.local.set(data, () => {
//           console.log('Data has been transferred to local storage.');

//           // 移行後、旧データを削除
//           chrome.storage.sync.clear(() => {
//             console.log('Old shared data has been cleared.');
//           });
//         });
//       }
//     });
//   }
// });
