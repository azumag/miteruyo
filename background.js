const twitchDomain = 'https://www.twitch.tv';
const multiTwitchURL = 'https://www.multitwitch.tv/';

// const clientId = 'vzlsgu6bdv9tbad1uroc9v8tz813cx'; // for prod
const clientId = 'lt060jwpltwp3weqdk53dx450aj99p';

// Twitchのシステムページ（チャンネルページではないパス）
const TWITCH_NON_CHANNEL_PATHS = [
  'directory', 'settings', 'p', 'downloads', 'turbo', 'wallet',
  'drops', 'inventory', 'search', 'jobs', 'prime', 'subscriptions',
  'following', 'friends', 'u', 'teams', 'moderator', 'videos',
  'clips', 'popout', 'embed', 'chat', 'broadcast'
];

// URLがTwitchのチャンネルページかどうかをチェック
function isTwitchChannelPage(url) {
  if (!url || !url.includes('twitch.tv')) return false;

  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(p => p);

    // パスがない場合はチャンネルページではない
    if (pathParts.length === 0) return false;

    const firstPath = pathParts[0].toLowerCase();

    // システムページの場合はチャンネルページではない
    if (TWITCH_NON_CHANNEL_PATHS.includes(firstPath)) return false;

    // チャンネル名として有効かチェック（英数字、アンダースコア、3-25文字）
    if (!/^[a-z0-9_]{3,25}$/i.test(firstPath)) return false;

    return true;
  } catch {
    return false;
  }
}

// Service Workerの再起動に備えてアラームを確認・作成する関数
async function ensureAlarmsExist() {
  console.log('ensureAlarmsExist called');

  // periodicalUpdate アラームの確認
  const existingAlarm = await chrome.alarms.get('periodicalUpdate');
  if (!existingAlarm) {
    console.log('Creating periodicalUpdate alarm');
    chrome.alarms.create('periodicalUpdate', { periodInMinutes: 1 });
  } else {
    console.log('periodicalUpdate alarm already exists');
  }

  // tabRotationAlarm アラームの確認
  const tabRotationAlarm = await chrome.alarms.get('tabRotationAlarm');
  if (!tabRotationAlarm) {
    const data = await chrome.storage.local.get('tabRotationInterval');
    if (data.tabRotationInterval) {
      // 最小値を1分に制限
      const interval = Math.max(1, parseInt(data.tabRotationInterval, 10) || 1);
      console.log('Creating tabRotationAlarm with interval:', interval);
      chrome.alarms.create('tabRotationAlarm', { periodInMinutes: interval });
    }
  } else {
    console.log('tabRotationAlarm already exists');
  }
}

// Chrome起動時にアラームを確認
chrome.runtime.onStartup.addListener(() => {
  console.log('onStartup event');
  ensureAlarmsExist();
});

// 拡張機能のインストール/アップデート時にアラームを確認
chrome.runtime.onInstalled.addListener((details) => {
  console.log('onInstalled event:', details.reason);
  ensureAlarmsExist();

  // コンテキストメニューを作成
  chrome.contextMenus.create({
    id: 'openWithMiteruyo',
    title: chrome.i18n.getMessage('openWithMiteruyo') || 'Miteruyoで開く',
    contexts: ['link'],
    targetUrlPatterns: ['*://*.twitch.tv/*']
  });
});

// コンテキストメニューのクリックハンドラ
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'openWithMiteruyo' && info.linkUrl) {
    // TwitchのURLからチャンネル名を抽出
    if (!isTwitchChannelPage(info.linkUrl)) {
      console.log('Not a channel page:', info.linkUrl);
      return;
    }

    try {
      const url = new URL(info.linkUrl);
      const pathParts = url.pathname.split('/').filter(p => p);
      if (pathParts.length === 0) return;

      const channelName = pathParts[0];
      console.log('Opening channel from context menu:', channelName);

      // Miteruyoの管理対象ウィンドウで開く
      await openInManagedWindow(channelName);
    } catch (error) {
      console.error('Error opening from context menu:', error);
    }
  }
});

// Miteruyoの管理対象ウィンドウでタブを開く
async function openInManagedWindow(channelName) {
  const url = twitchDomain + '/' + channelName;
  const data = await chrome.storage.local.get(['isOpenNewWindow', 'lastOpenWindowId']);

  if (data.isOpenNewWindow) {
    // 新しいウィンドウで開く設定の場合
    let windowId = data.lastOpenWindowId;

    // 既存のウィンドウが有効かチェック
    if (windowId) {
      const windowExists = await checkWindowExists(windowId);
      if (!windowExists) {
        windowId = null;
      }
    }

    if (windowId) {
      // 既存の管理対象ウィンドウにタブを追加
      await chrome.tabs.create({ url, windowId });
    } else {
      // 新しいウィンドウを作成して管理対象に登録
      const newWindow = await chrome.windows.create({ url });
      await chrome.storage.local.set({ lastOpenWindowId: newWindow.id });
    }
  } else {
    // 現在のウィンドウで開く
    const tab = await chrome.tabs.create({ url });
    // 開いたタブのウィンドウを管理対象に登録
    await chrome.storage.local.set({ lastOpenWindowId: tab.windowId });
  }
}

// Service Worker起動時にもアラームを確認（フォールバック）
ensureAlarmsExist();

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === 'periodicalUpdate') {
    checkStreams();
  }
  if (alarm.name === 'tabRotationAlarm') {
    checkTabRotate();
  }
});

// tab Rotation Interval が変更されたときにアラームの間隔を更新
chrome.storage.onChanged.addListener((changes) => {
  for (let key in changes) {
    if (key === 'tabRotationInterval') {
      // アラームを一度削除
      chrome.alarms.clear('tabRotationAlarm');
      // 新しい間隔でアラームを作成（最小値1分）
      const interval = Math.max(1, parseInt(changes[key].newValue, 10) || 1);
      chrome.alarms.create('tabRotationAlarm', { periodInMinutes: interval });
    }
  }
});

chrome.tabs.onActivated.addListener(async activeInfo => {
  const targetWindowId = (await chrome.storage.local.get('lastOpenWindowId')).lastOpenWindowId;
  const enableTabMute = (await chrome.storage.local.get('isEnabledTabMute')).isEnabledTabMute;
  const enableAutoClose = (await chrome.storage.local.get('isEnabledAutoClose')).isEnabledAutoClose;

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
    if (enableAutoClose) {
      if (await checkOfflineWithTab(activeInfo.tabId)) {
        console.log('close tab', activeInfo.tabId);
        chrome.tabs.remove(activeInfo.tabId);
      }
    }
  }
});

async function checkTabRotate() {
  const isEnabledTabRotation = (await chrome.storage.local.get('isEnabledTabRotation')).isEnabledTabRotation;
  const targetWindowId = (await chrome.storage.local.get('lastOpenWindowId')).lastOpenWindowId;
  if (!isEnabledTabRotation) return;
  if (!targetWindowId) return;

  const enableTabMute = (await chrome.storage.local.get('isEnabledTabMute')).isEnabledTabMute;

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

          // suspend previous tab
          // const suspendedUrl = "chrome-extension://" + chrome.runtime.id + "/suspended.html#" + encodeURIComponent(tabs[currentTabIndex].url);
          // chrome.tabs.update(tabs[currentTabIndex].id, { url: suspendedUrl });

          // Close duplicate tabs
          // タブURLからクエリパラメータを削除（無効なURLはスキップ）
          const urls = tabs.map(tab => {
            if (!tab.url || !tab.url.startsWith('http')) {
              return tab.url || '';
            }
            try {
              const url = new URL(tab.url);
              url.search = ''; // クエリパラメータを削除
              return url.toString();
            } catch {
              return tab.url || '';
            }
          });

          // 最初に見つかったタブのみを保持し、重複するタブを削除
          const tabsToRemove = [];
          tabs = tabs.filter((tab, index) => {
            if (!tab.url || !tab.url.startsWith('http')) {
              return true; // 無効なURLはスキップ
            }
            try {
              const url = new URL(tab.url);
              url.search = '';
              const urlString = url.toString();
              // URLが最初に登場する位置が現在のインデックスと異なる場合、これは重複タブと見なし削除リストに追加
              if (urls.indexOf(urlString) !== index) {
                tabsToRemove.push(tab);
                return false;
              }
              return true;
            } catch {
              return true; // 無効なURLはスキップ
            }
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
  console.log('checkStreams started at:', new Date().toISOString());

  try {
    const isEnabled = (await chrome.storage.local.get('isEnabled')).isEnabled;
    const isOpenMultiTwitch = (await chrome.storage.local.get('isOpenMultiTwitch')).isOpenMultiTwitch;

    if (!isEnabled) {
      console.log('checkStreams: extension is disabled');
      return;
    }

    const channels = (await chrome.storage.local.get('channels')).channels;
    const oauth_token = (await chrome.storage.local.get('oauth_token')).oauth_token;

    if (!oauth_token) {
      console.log('checkStreams: no oauth_token');
      return;
    }

    if (!channels || channels.length === 0) {
      console.log('checkStreams: no channels');
      return;
    }

    // 並列でチャンネルをチェック（30秒制限対策）
    console.log(`checkStreams: checking ${channels.length} channels in parallel`);
    const updatedChannels = await Promise.all(
      channels.map(channel =>
        checkStream(channel, oauth_token)
          .catch(error => {
            console.error(`Error checking channel ${channel.name}:`, error);
            // エラー時は既存のチャンネル情報を返す（statusをerrorに設定）
            return { ...channel, status: 'error' };
          })
      )
    );

    // 一括でストレージに保存（個別保存より効率的）
    await chrome.storage.local.set({ channels: updatedChannels });
    console.log('checkStreams: channels saved');

    if (isOpenMultiTwitch) {
      channelQueuedStreamsInMultiTwitch();
    } else {
      channelQueuedStreams(updatedChannels);
    }

    // オフラインになったチャンネルのタブを自動で閉じる
    const enableAutoClose = (await chrome.storage.local.get('isEnabledAutoClose')).isEnabledAutoClose;
    if (enableAutoClose) {
      await closeOfflineTabs(updatedChannels);
    }

    console.log('checkStreams completed at:', new Date().toISOString());
  } catch (error) {
    console.error('checkStreams error:', error);
  }
}

// オフラインになったチャンネルのタブを閉じる
async function closeOfflineTabs(channels) {
  const targetWindowId = (await chrome.storage.local.get('lastOpenWindowId')).lastOpenWindowId;
  if (!targetWindowId) return;

  // ウィンドウが存在するか確認
  const windowExists = await checkWindowExists(targetWindowId);
  if (!windowExists) return;

  // オフラインのチャンネル名リストを作成
  const offlineChannelNames = channels
    .filter(ch => !ch.onLive)
    .map(ch => ch.name.toLowerCase());

  if (offlineChannelNames.length === 0) return;

  // 対象ウィンドウのタブを取得
  const tabs = await chrome.tabs.query({ windowId: targetWindowId });

  for (const tab of tabs) {
    // チャンネルページ以外（directoryなど）はスキップ
    if (!isTwitchChannelPage(tab.url)) continue;

    try {
      const url = new URL(tab.url);
      // URLからチャンネル名を抽出（例: /channelname または /channelname?...）
      const pathParts = url.pathname.split('/').filter(p => p);
      if (pathParts.length === 0) continue;

      const channelName = pathParts[0].toLowerCase();

      if (offlineChannelNames.includes(channelName)) {
        console.log('closeOfflineTabs: closing tab for offline channel:', channelName);
        await chrome.tabs.remove(tab.id);
      }
    } catch {
      // URLパース失敗時はスキップ
    }
  }
}

async function channelQueuedStreamsInMultiTwitch() {
}

// チャンネルを開くべきかどうかをチェック
async function shouldOpenChannel(channel) {
  if (!channel.onLive || !channel.onLiveOpen) return false;

  // プロモーション配信フィルター
  // New: Use per-channel brandedContentSetting ('open', 'block', 'global')
  const brandedSetting = channel.brandedContentSetting || 'global';
  let skipBranded;

  if (brandedSetting === 'open') {
    // Always allow branded content for this channel
    skipBranded = false;
  } else if (brandedSetting === 'block') {
    // Always block branded content for this channel
    skipBranded = true;
  } else {
    // Follow global setting
    skipBranded = (await chrome.storage.local.get('isSkipBrandedContent')).isSkipBrandedContent;
  }

  console.log('shouldOpenChannel check:', {
    channel: channel.name,
    brandedSetting,
    skipBranded,
    is_branded_content: channel.is_branded_content,
    typeof_branded: typeof channel.is_branded_content
  });
  if (skipBranded && channel.is_branded_content === true) {
    console.log('Skipping branded content:', channel.name);
    return false;
  }

  // カテゴリフィルター（game_idで比較、フォールバックとしてgame_nameで比較）
  // Support new {id, name} object format and old formats for backwards compatibility
  const storageData = await chrome.storage.local.get(['blockedCategoryList', 'blockedCategoryNames']);
  let globalBlockedList = storageData.blockedCategoryList || [];

  // Migrate from old comma-separated format if needed
  if (globalBlockedList.length === 0 && storageData.blockedCategoryNames) {
    globalBlockedList = storageData.blockedCategoryNames
      .replace(/\\,/g, '__M_COMMA__')
      .split(',')
      .map(c => c.trim().replace(/__M_COMMA__/g, ','))
      .filter(c => c)
      .map(name => ({ id: null, name }));
  }

  // Normalize to {id, name} format if old string array
  globalBlockedList = globalBlockedList.map(item =>
    typeof item === 'string' ? { id: null, name: item } : (item || { id: null, name: '' })
  ).filter(item => item.name);

  const channelBlockedList = (channel.blockedCategoryList || []).map(item =>
    typeof item === 'string' ? { id: null, name: item } : (item || { id: null, name: '' })
  ).filter(item => item.name);

  const allowedCategoryList = (channel.allowedCategoryList || channel.allowedCategories || []).map(item =>
    typeof item === 'string' ? { id: null, name: item } : (item || { id: null, name: '' })
  ).filter(item => item.name);

  // Combine both global and channel-specific blocked categories
  const combinedBlockedList = [...globalBlockedList, ...channelBlockedList];

  if (combinedBlockedList.length > 0 && (channel.game_id || channel.game_name)) {
    const gameId = channel.game_id;
    const gameName = channel.game_name?.toLowerCase();

    // Check if this category is explicitly allowed for this channel (by id first, then name)
    const isAllowed = allowedCategoryList.some(cat =>
      (gameId && cat.id && cat.id === gameId) ||
      (gameName && cat.name && cat.name.toLowerCase() === gameName)
    );

    if (isAllowed) {
      console.log('Category allowed by per-channel override:', channel.name, channel.game_name, channel.game_id);
      // Skip blocking - this category is allowed
    } else {
      // Check if category is in blocked list (by id first, then name as fallback)
      const isBlocked = combinedBlockedList.some(blocked =>
        (gameId && blocked.id && blocked.id === gameId) ||
        (gameName && blocked.name && blocked.name.toLowerCase() === gameName)
      );

      if (isBlocked) {
        console.log('Skipping blocked category:', channel.name, channel.game_name, channel.game_id);
        return false;
      }
    }
  }

  return true;
}

async function channelQueuedStreams(channelQueue) {
  const isOpenNewWindow = (await chrome.storage.local.get('isOpenNewWindow')).isOpenNewWindow;
  console.log('channelQueueStreams', { isOpenNewWindow });
  if (isOpenNewWindow) {
    // ループ内で更新するためにletで宣言
    let currentWindowId = (await chrome.storage.local.get('lastOpenWindowId')).lastOpenWindowId;

    for (const channel of channelQueue) {
      if (await shouldOpenChannel(channel)) {
        console.log('channelQueueStreams', { currentWindowId });

        // 現在のウィンドウIDが有効かチェック
        const windowExists = currentWindowId && await checkWindowExists(currentWindowId);

        if (windowExists) {
          // 既存のウィンドウにタブを追加
          openTabIfNotExists(channel, currentWindowId);
        } else {
          // 新しいウィンドウを作成する必要がある
          const tabs = await chrome.tabs.query({});
          const targetURL = channelURL(channel);
          const matchingTabs = tabs.filter(tab => tab.url === targetURL);

          if (matchingTabs.length === 0) {
            console.log('openNewWindow', { targetURL, matchingTabs: matchingTabs.length });
            const newWindow = await chrome.windows.create({ url: targetURL });
            // 新しいウィンドウIDを保存し、ループ内で再利用
            currentWindowId = newWindow.id;
            await chrome.storage.local.set({ lastOpenWindowId: currentWindowId });
            console.log('New window created, ID:', currentWindowId);
          }
        }
      }
    }
  } else {
    for (const channel of channelQueue) {
      if (await shouldOpenChannel(channel)) {
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

function openTabIfNotExists(channel, windowId = null) {
  const targetURL = channelURL(channel);
  console.log('openTabIfNotExists', { targetURL, windowId });
  chrome.tabs.query({}, tabs => {
    const matchingTabs = tabs.filter(tab => {
      // タブのURLが無効な場合はスキップ（chrome://、about:blank など）
      if (!tab.url || !tab.url.startsWith('http')) {
        return false;
      }
      try {
        // 既存のタブのURLからクエリパラメータを除去
        const tabURLWithoutQuery = new URL(tab.url);
        tabURLWithoutQuery.search = '';
        return tabURLWithoutQuery.toString() === targetURL; // クエリパラメータを除去したURLで比較
      } catch {
        // 無効なURLの場合はスキップ
        return false;
      }
    });

    if (matchingTabs.length === 0) {
      chrome.tabs.create({ url: targetURL, windowId });
    }
  });
}

function getUserId(clientId, accessToken, username) {
  const requestUrl = `https://api.twitch.tv/helix/users?login=${username}`;

  return fetch(requestUrl, {
    headers: {
      'Client-ID': clientId,
      'Authorization': `Bearer ${accessToken}`
    }
  })
    .then((response) => response.json())
    .then((data) => {
      // console.log(data);
      if (data.data.length > 0) {
        return data.data[0].id;
      } else {
        throw new Error('User not found');
      }
    })
    .catch((error) => {
      console.error('Error fetching user ID:', error);
      console.error('username', username);
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

  // チャンネルページ以外（directory、settingsなど）は閉じない
  if (!isTwitchChannelPage(tabUrl)) {
    console.log('tab is not a channel page', tabUrl);
    return false;
  }

  // URLからチャンネル名を抽出
  const urlObj = new URL(tabUrl);
  const pathParts = urlObj.pathname.split('/').filter(p => p);
  const channelName = pathParts[0].split('?')[0];
  console.log('channelName', channelName);

  const accessToken = (await chrome.storage.local.get('oauth_token')).oauth_token.oauth_token;

  if (!accessToken) {
    return;
  }

  const userId = await getUserId(clientId, accessToken, channelName);
  const requestUrl = `https://api.twitch.tv/helix/streams?user_id=${userId}`;
  const response = await fetch(requestUrl, {
    headers: {
      'Client-ID': clientId,
      'Authorization': `Bearer ${accessToken}`
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
  if (!channel) return null;

  const url = `https://api.twitch.tv/helix/streams?user_login=${channel.name}`;
  const options = {
    headers: {
      'Client-ID': clientId,
      'Accept': 'application/vnd.twitchtv.v5+json',
      'Authorization': 'Bearer ' + oauth_token.oauth_token,
    },
  };

  try {
    // タイムアウト付きfetch（10秒）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`checkStream: HTTP error ${response.status} for ${channel.name}`);
      return { ...channel, status: 'error', lastError: `HTTP ${response.status}` };
    }

    const data = await response.json();

    if (data.data === undefined) {
      console.error(`checkStream: Invalid response for ${channel.name}`, data);
      return { ...channel, status: 'error', lastError: 'Invalid response' };
    }

    if (data.data.length > 0) {
      const stream = data.data[0];

      // /helix/channels から is_branded_content を取得
      // (/helix/streams にはこのフィールドがないため)
      let is_branded_content = false;
      try {
        const channelInfoUrl = `https://api.twitch.tv/helix/channels?broadcaster_id=${stream.user_id}`;
        const channelResponse = await fetch(channelInfoUrl, options);
        if (channelResponse.ok) {
          const channelData = await channelResponse.json();
          if (channelData.data && channelData.data.length > 0) {
            is_branded_content = channelData.data[0].is_branded_content === true;
          }
        }
      } catch (error) {
        console.error(`checkStream: Error fetching channel info for ${channel.name}:`, error);
      }

      console.log('online', channel.name, {
        is_branded_content,
        game_name: stream.game_name
      });

      return {
        ...channel,
        onLive: true,
        game_name: stream.game_name,
        game_id: stream.game_id,
        tags: stream.tags,
        title: stream.title,
        viewer_count: stream.viewer_count,
        is_branded_content,
        status: 'online',
        lastChecked: Date.now()
      };
    } else {
      console.log('offline', channel.name);
      return {
        ...channel,
        onLive: false,
        status: 'offline',
        lastChecked: Date.now()
      };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`checkStream: Timeout for ${channel.name}`);
      return { ...channel, status: 'error', lastError: 'Timeout' };
    }
    console.error(`checkStream: Error for ${channel.name}:`, error);
    return { ...channel, status: 'error', lastError: error.message };
  }
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
