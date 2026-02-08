import {
  ensureAlarmsExist,
  checkStreams,
  checkTabRotate,
  isTwitchChannelPage,
  openInManagedWindow,
  showNotification,
  checkOfflineWithTab,
  onWindowRemoved,
  onStorageChangedForTabRotation,
  onStorageChangedForCheckInterval,
  onNotificationClicked,
} from './background-functions.js';

// Service Worker起動時にもアラームを確認（フォールバック）
ensureAlarmsExist().catch(e => console.error('ensureAlarmsExist error:', e));

// Chrome起動時にアラームを確認
chrome.runtime.onStartup.addListener(async () => {
  try {
    console.log('onStartup event');
    await ensureAlarmsExist();
  } catch (e) {
    console.error('onStartup error:', e);
  }
});

// 拡張機能のインストール/アップデート時にアラームを確認
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    console.log('onInstalled event:', details.reason);
    await ensureAlarmsExist();

    // コンテキストメニューを作成
    chrome.contextMenus.create({
      id: 'openWithMiteruyo',
      title: chrome.i18n.getMessage('openWithMiteruyo') || 'Miteruyoで開く',
      contexts: ['link'],
      targetUrlPatterns: ['*://*.twitch.tv/*']
    });

    chrome.contextMenus.create({
      id: 'addToMiteruyo',
      title: chrome.i18n.getMessage('addToMiteruyo') || 'Miteruyoに追加',
      contexts: ['link', 'page'],
      targetUrlPatterns: ['*://*.twitch.tv/*'],
      documentUrlPatterns: ['*://*.twitch.tv/*']
    });
  } catch (e) {
    console.error('onInstalled error:', e);
  }
});

// コンテキストメニューのクリックハンドラ
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'openWithMiteruyo' && info.linkUrl) {
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
      await openInManagedWindow(channelName);
    } catch (error) {
      console.error('Error opening from context menu:', error);
    }
  }

  if (info.menuItemId === 'addToMiteruyo') {
    const targetUrl = info.linkUrl || info.pageUrl;
    if (!isTwitchChannelPage(targetUrl)) {
      console.log('Not a channel page:', targetUrl);
      return;
    }

    try {
      const url = new URL(targetUrl);
      const pathParts = url.pathname.split('/').filter(p => p);
      if (pathParts.length === 0) return;

      const channelName = pathParts[0];
      console.log('Adding channel from context menu:', channelName);

      const channel = {
        name: channelName,
        categoriesFilter: '',
        tagsFilter: '',
        onLiveOpen: true,
      };

      const data = await chrome.storage.local.get('channels');
      const channels = data.channels || [];
      const index = channels.findIndex((c) => c?.name === channel.name);

      if (index === -1) {
        const filteredChannels = channels.filter(c => c !== null);
        const newChannels = [...filteredChannels, channel];
        await chrome.storage.local.set({ channels: newChannels });
        console.log('Channel added:', channelName);
        await checkStreams();
      } else {
        console.log('Channel already exists:', channelName);
      }
    } catch (error) {
      console.error('Error adding from context menu:', error);
    }
  }
});

chrome.alarms.onAlarm.addListener(async function (alarm) {
  try {
    console.log('Alarm fired:', alarm.name);
    if (alarm.name === 'periodicalUpdate') {
      await checkStreams();
    }
    if (alarm.name === 'tabRotationAlarm') {
      await checkTabRotate();
    }
  } catch (e) {
    console.error('onAlarm error:', e);
  }
});

// tab Rotation / check interval の設定が変更されたときにアラームを更新
chrome.storage.onChanged.addListener(async (changes, area) => {
  try {
    await onStorageChangedForTabRotation(changes, area);
    await onStorageChangedForCheckInterval(changes, area);
  } catch (e) {
    console.error('onStorageChanged error:', e);
  }
});

// ウィンドウが閉じられたときに lastOpenWindowId をクリア
chrome.windows.onRemoved.addListener(async (windowId) => {
  try {
    await onWindowRemoved(windowId);
  } catch (e) {
    console.error('onWindowRemoved error:', e);
  }
});

chrome.tabs.onActivated.addListener(async activeInfo => {
  try {
    const { lastOpenWindowId: targetWindowId, isEnabledTabMute: enableTabMute, isEnabledAutoClose: enableAutoClose } = await chrome.storage.local.get(['lastOpenWindowId', 'isEnabledTabMute', 'isEnabledAutoClose']);

    if (activeInfo.windowId === targetWindowId) {
      console.log('activated', activeInfo, enableTabMute, enableAutoClose);
      if (enableTabMute) {
        const tabs = await chrome.tabs.query({ windowId: targetWindowId });
        await Promise.all(tabs.map(tab =>
          chrome.tabs.update(tab.id, { muted: tab.id !== activeInfo.tabId })
        ));
      }
      if (enableAutoClose) {
        if (await checkOfflineWithTab(activeInfo.tabId)) {
          console.log('close tab', activeInfo.tabId);
          await chrome.tabs.remove(activeInfo.tabId);
        }
      }
    }
  } catch (e) {
    console.error('onActivated error:', e);
  }
});

// 通知クリック時のハンドラ
chrome.notifications.onClicked.addListener(async (notificationId) => {
  try {
    await onNotificationClicked(notificationId);
  } catch (e) {
    console.error('notification click error:', e);
  }
});

// メッセージリスナーを追加
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'testNotification') {
    showNotification({
      name: 'TEST_USER',
      title: 'テスト配信タイトル / Test Stream Title',
      game_name: 'Just Chatting'
    });
    sendResponse({ status: 'ok' });
  } else if (message.action === 'openInManagedWindow') {
    openInManagedWindow(message.channelName).then(() => sendResponse({ status: 'ok' }));
    return true;
  } else if (message.type === 'clearNotifications') {
    chrome.notifications.getAll((notifications) => {
      for (const id in notifications) {
        if (id.startsWith('miteruyo-live-')) {
          chrome.notifications.clear(id);
        }
      }
    });
    sendResponse({ status: 'ok' });
  }
  return true;
});
