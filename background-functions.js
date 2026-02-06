const twitchDomain = 'https://www.twitch.tv';

const clientId = 'lt060jwpltwp3weqdk53dx450aj99p';

// Twitchのシステムページ（チャンネルページではないパス）
const TWITCH_NON_CHANNEL_PATHS = [
  'directory', 'settings', 'p', 'downloads', 'turbo', 'wallet',
  'drops', 'inventory', 'search', 'jobs', 'prime', 'subscriptions',
  'following', 'friends', 'u', 'teams', 'moderator', 'videos',
  'clips', 'popout', 'embed', 'chat', 'broadcast'
];

// URLがTwitchのチャンネルページかどうかをチェック
export function isTwitchChannelPage(url) {
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
export async function ensureAlarmsExist() {
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
    const data = await chrome.storage.local.get(['tabRotationInterval', 'isEnabledTabRotation']);
    // タブローテーションが有効な場合のみアラームを作成
    if (data.isEnabledTabRotation) {
      // 最小値を1分に制限、デフォルト値は5分
      const interval = Math.max(1, parseInt(data.tabRotationInterval, 10) || 5);
      console.log('Creating tabRotationAlarm with interval:', interval);
      chrome.alarms.create('tabRotationAlarm', { periodInMinutes: interval });
    }
  } else {
    console.log('tabRotationAlarm already exists');
  }
}

// Miteruyoの管理対象ウィンドウでタブを開く
export async function openInManagedWindow(channelName) {
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

export async function checkTabRotate() {
  const isEnabledTabRotation = (await chrome.storage.local.get('isEnabledTabRotation')).isEnabledTabRotation;
  const targetWindowId = (await chrome.storage.local.get('lastOpenWindowId')).lastOpenWindowId;
  if (!isEnabledTabRotation) return;
  if (!targetWindowId) return;

  const enableTabMute = (await chrome.storage.local.get('isEnabledTabMute')).isEnabledTabMute;

  try {
    await chrome.windows.get(targetWindowId);
  } catch {
    console.log('Tab rotation: target window not found, clearing lastOpenWindowId');
    chrome.storage.local.set({ lastOpenWindowId: null });
    return;
  }

  // If the window exists, switch tabs
  const tabs = await chrome.tabs.query({ windowId: targetWindowId });
  if (tabs.length > 1) {
    let currentTabIndex = tabs.findIndex((tab) => tab.active);
    let nextTabIndex = (currentTabIndex + 1) % tabs.length;

    chrome.tabs.update(tabs[currentTabIndex].id, { muted: enableTabMute });
    chrome.tabs.update(tabs[nextTabIndex].id, { active: true, muted: false });

    // suspend previous tab
    // const suspendedUrl = "chrome-extension://" + chrome.runtime.id + "/suspended.html#" + encodeURIComponent(tabs[currentTabIndex].url);
    // chrome.tabs.update(tabs[currentTabIndex].id, { url: suspendedUrl });

    // Close duplicate tabs
    // Deduplicate tabs based on URL without query parameters
    const seenUrls = new Set();
    const tabsToRemove = [];
    for (const tab of tabs) {
      if (!tab.url || !tab.url.startsWith('http')) continue;
      const urlWithoutQuery = tab.url.split('?')[0];
      if (seenUrls.has(urlWithoutQuery)) {
        tabsToRemove.push(tab.id);
      } else {
        seenUrls.add(urlWithoutQuery);
      }
    }
    if (tabsToRemove.length > 0) {
      chrome.tabs.remove(tabsToRemove);
    }
  }
}

// Migrate old nested token format { oauth_token: "token" } (object) to flat string "token"
export function migrateOAuthToken(token) {
  if (token && typeof token === 'object' && token.oauth_token) {
    return token.oauth_token;
  }
  return token;
}

export async function validateToken(token) {
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': 'OAuth ' + token }
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function checkStreams() {
  console.log('checkStreams started at:', new Date().toISOString());

  try {
    const data = await chrome.storage.local.get(['isEnabled', 'isEnabledNotifications', 'isOpenMultiTwitch', 'channels', 'oauth_token']);
    console.log('checkStreams data:', {
      isEnabled: data.isEnabled,
      isEnabledNotifications: data.isEnabledNotifications,
      channelsCount: data.channels?.length,
      hasToken: !!data.oauth_token
    });

    if (!data.isEnabled && !data.isEnabledNotifications) {
      console.log('checkStreams: both extension and notifications are disabled');
      return;
    }

    const channels = data.channels || [];
    let oauth_token = migrateOAuthToken(data.oauth_token);

    if (!oauth_token || typeof oauth_token !== 'string') {
      console.log('checkStreams: no oauth_token');
      return;
    }

    // Persist migrated token if format changed
    if (data.oauth_token !== oauth_token) {
      await chrome.storage.local.set({ oauth_token });
    }

    if (channels.length === 0) {
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

    // 通知の判定
    const isEnabledNotifications = data.isEnabledNotifications;
    for (let i = 0; i < updatedChannels.length; i++) {
      const newStatus = updatedChannels[i];
      const oldStatus = channels[i]; // channels は更新前のリスト

      console.log(`Notification check for ${newStatus.name}:`, {
        newLive: newStatus.onLive,
        oldLive: oldStatus?.onLive,
        notifySetting: newStatus.notificationSetting || 'global'
      });

      // オフライン -> オンライン への移行を検知
      if (newStatus.onLive && (!oldStatus || !oldStatus.onLive)) {
        // 通知設定の確認
        const notifySetting = newStatus.notificationSetting || 'global';
        let shouldNotify = false;

        if (notifySetting === 'on') {
          shouldNotify = true;
        } else if (notifySetting === 'off') {
          shouldNotify = false;
        } else {
          // global settings
          shouldNotify = isEnabledNotifications;
        }

        if (shouldNotify) {
          console.log(`Triggering notification for ${newStatus.name}`);
          showNotification(newStatus);
        } else {
          console.log(`Notification skipped for ${newStatus.name} based on settings`);
        }
      }
    }

    const isOpenMultiTwitch = data.isOpenMultiTwitch;
    if (data.isEnabled) {
      if (isOpenMultiTwitch) {
        channelQueuedStreamsInMultiTwitch();
      } else {
        channelQueuedStreams(updatedChannels);
      }
    } else {
      console.log('checkStreams: Auto-open skipped as isEnabled is false');
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
async function closeOfflineTabs(updatedChannels) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url) continue;
    const match = tab.url.match(/https?:\/\/(?:www\.)?twitch\.tv\/([^/?]+)/);
    if (match) {
      const channelName = match[1].toLowerCase();
      // チャンネルリストに含まれており、かつ現在オフラインのものを探す
      const channel = updatedChannels.find(c => c.name.toLowerCase() === channelName);
      if (channel && !channel.onLive) {
        chrome.tabs.remove(tab.id).catch(() => { });
      }
    }
  }
}

// デスクトップ通知を表示
export function showNotification(channel) {
  const notificationId = `miteruyo-live-${channel.name}-${Date.now()}`;

  // Build notification message with title and category
  let message = '';

  // Add stream title if available
  if (channel.title) {
    message = channel.title;
    // Add category if available
    if (channel.game_name) {
      message += `\n【${channel.game_name}】`;
    }
  } else if (channel.game_name) {
    // Only category available
    message = `【${channel.game_name}】`;
  } else {
    // Fallback to default message
    message = chrome.i18n.getMessage('notificationTitle') || '配信開始！';
  }

  const options = {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon.png'),
    title: chrome.i18n.getMessage('notificationBody', [channel.name]) || `${channel.name} が配信を開始しました！`,
    message: message,
    priority: 2,
    eventTime: Date.now(),
    requireInteraction: false
  };

  chrome.notifications.create(notificationId, options);
}

export async function channelQueuedStreamsInMultiTwitch() {
  const data = await chrome.storage.local.get(['channels', 'isEnabled']);
  if (!data.isEnabled) return;
  const channels = data.channels || [];
  const liveChannels = channels.filter(c => c.onLive && c.onLiveOpen);
  if (liveChannels.length === 0) return;

  // MultiTwitch URLの作成
  const channelNames = liveChannels.map(c => c.name).join('/');
  const multiTwitchUrl = `https://multitwitch.tv/${channelNames}`;

  // すでに開いているウィンドウか新しいウィンドウで開く
  const windowId = (await chrome.storage.local.get('lastOpenWindowId')).lastOpenWindowId;
  openTabIfNotExists({ url: multiTwitchUrl }, windowId);
}

// チャンネルを開くべきかどうかをチェック
export async function shouldOpenChannel(channel) {
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
  // Priority: allowedOnlyCategoryList > blocked/allowed lists

  // Check for allowed-only categories (individual then global)
  const channelAllowedOnlyList = (channel.allowedOnlyCategoryList || []).map(item =>
    typeof item === 'string' ? { id: null, name: item } : (item || { id: null, name: '' })
  ).filter(item => item.name);

  const storageData = await chrome.storage.local.get(['allowedOnlyCategoryList', 'blockedCategoryList', 'blockedCategoryNames']);
  const globalAllowedOnlyList = (storageData.allowedOnlyCategoryList || []).map(item =>
    typeof item === 'string' ? { id: null, name: item } : (item || { id: null, name: '' })
  ).filter(item => item.name);

  // If allowed-only list is set (individual or global), ONLY open if category matches
  if (channelAllowedOnlyList.length > 0 || globalAllowedOnlyList.length > 0) {
    const activeAllowedOnlyList = channelAllowedOnlyList.length > 0 ? channelAllowedOnlyList : globalAllowedOnlyList;

    if (!channel.game_id && !channel.game_name) {
      // No category info - block by default when allowed-only is active
      console.log('Skipping - no category info with allowed-only filter active:', channel.name);
      return false;
    }

    const gameId = channel.game_id;
    const gameName = channel.game_name?.toLowerCase();

    const isInAllowedOnly = activeAllowedOnlyList.some(cat =>
      (gameId && cat.id && cat.id === gameId) ||
      (gameName && cat.name && cat.name.toLowerCase() === gameName)
    );

    if (!isInAllowedOnly) {
      console.log('Skipping - not in allowed-only list:', channel.name, channel.game_name, channel.game_id);
      return false;
    }

    console.log('Opening - matches allowed-only list:', channel.name, channel.game_name, channel.game_id);
    return true;
  }

  // Original blocked/allowed logic (when no allowed-only list is set)
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

export async function channelQueuedStreams(channelQueue) {
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
          await openTabIfNotExists(channel, currentWindowId);
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
        await openTabIfNotExists(channel);
      }
    }
  }
}

export async function checkOfflineWithTab(tabId) {
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

  const accessToken = migrateOAuthToken((await chrome.storage.local.get('oauth_token')).oauth_token);

  if (!accessToken || typeof accessToken !== 'string') {
    return;
  }

  const userId = await getUserId(clientId, accessToken, channelName);
  if (!userId) return false;
  const requestUrl = `https://api.twitch.tv/helix/streams?user_id=${userId}`;
  const response = await fetchWithRetry(requestUrl, {
    headers: {
      'Client-ID': clientId,
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    return false;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return false;
  }

  if (data.data && data.data.length > 0) {
    // online
    return false;
  } else {
    // offline
    return true;
  }
}

// tab Rotation の設定が変更されたときにアラームを更新
export async function onStorageChangedForTabRotation(changes, area) {
  if (area === 'local' && (changes.isEnabledTabRotation || changes.tabRotationInterval)) {
    // 設定変更時はアラームを再設定（ensureAlarmsExistに処理を統合）
    const tabRotationAlarm = await chrome.alarms.get('tabRotationAlarm');
    if (tabRotationAlarm) {
      await chrome.alarms.clear('tabRotationAlarm');
    }
    const data = await chrome.storage.local.get(['tabRotationInterval', 'isEnabledTabRotation']);
    if (data.isEnabledTabRotation) {
      const interval = Math.max(1, parseInt(data.tabRotationInterval, 10) || 5);
      console.log('Tab rotation settings changed, creating alarm with interval:', interval);
      chrome.alarms.create('tabRotationAlarm', { periodInMinutes: interval });
    } else {
      console.log('Tab rotation disabled, alarm cleared');
    }
  }
}

// ウィンドウが閉じられたときに lastOpenWindowId をクリア
export async function onWindowRemoved(windowId) {
  const data = await chrome.storage.local.get('lastOpenWindowId');
  if (windowId === data.lastOpenWindowId) {
    console.log('Managed window closed, clearing lastOpenWindowId');
    await chrome.storage.local.set({ lastOpenWindowId: null });
  }
}

export async function onNotificationClicked(notificationId) {
  const channelName = parseNotificationChannelName(notificationId);
  if (!channelName) {
    return;
  }

  await openInManagedWindow(channelName);
  chrome.notifications.clear(notificationId);
}

// --- Internal (non-exported) helper functions ---

// 通知IDからチャンネル名を抽出・バリデーション
// Format: miteruyo-live-{channelName}-{timestamp}
function parseNotificationChannelName(notificationId) {
  if (!notificationId || !notificationId.startsWith('miteruyo-live-')) return null;
  const withoutPrefix = notificationId.slice('miteruyo-live-'.length);
  const lastDashIndex = withoutPrefix.lastIndexOf('-');
  if (lastDashIndex <= 0) return null;
  const channelName = withoutPrefix.substring(0, lastDashIndex);
  if (!/^[a-zA-Z0-9_]{1,25}$/.test(channelName)) return null;
  return channelName;
}

function channelURL(channel) {
  return twitchDomain + '/' + channel.name;
}

async function checkWindowExists(windowId) {
  try {
    await chrome.windows.get(windowId, { populate: false });
    return true;
  } catch {
    return false;
  }
}

async function openTabIfNotExists(channel, windowId = null) {
  const targetURL = channelURL(channel);
  console.log('openTabIfNotExists', { targetURL, windowId });
  const tabs = await chrome.tabs.query({});
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
    await chrome.tabs.create({ url: targetURL, windowId });
  }
}

function getUserId(clientId, accessToken, username) {
  const requestUrl = `https://api.twitch.tv/helix/users?login=${username}`;

  return fetchWithRetry(requestUrl, {
    headers: {
      'Client-ID': clientId,
      'Authorization': `Bearer ${accessToken}`
    }
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
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
      return null;
    });
}

async function getTabUrl(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return tab.url;
}

async function fetchWithRetry(url, options, maxRetries = 1) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      const retryAfter = response.headers.get('Ratelimit-Reset');
      const waitMs = retryAfter
        ? Math.max(0, (parseInt(retryAfter, 10) * 1000) - Date.now())
        : (attempt + 1) * 2000;
      console.warn(`Rate limited, waiting ${waitMs}ms before retry (attempt ${attempt + 1})`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 10000)));
        continue;
      }
    }

    return response;
  }
}

async function checkStream(channel, oauth_token) {
  if (!channel) return null;

  const url = `https://api.twitch.tv/helix/streams?user_login=${channel.name}`;
  const options = {
    headers: {
      'Client-ID': clientId,
      'Accept': 'application/vnd.twitchtv.v5+json',
      'Authorization': 'Bearer ' + oauth_token,
    },
  };

  try {
    // タイムアウト付きfetch（10秒）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetchWithRetry(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`checkStream: HTTP error ${response.status} for ${channel.name}`);
      return { ...channel, status: 'error', lastError: `HTTP ${response.status}` };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      console.error(`checkStream: JSON parse error for ${channel.name}`);
      return { ...channel, status: 'error', lastError: 'JSON parse error' };
    }

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
        const channelResponse = await fetchWithRetry(channelInfoUrl, options);
        if (channelResponse.ok) {
          let channelData;
          try {
            channelData = await channelResponse.json();
          } catch {
            console.error(`checkStream: JSON parse error for channel info ${channel.name}`);
          }
          if (channelData && channelData.data && channelData.data.length > 0) {
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
