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
} from './background-functions.js';

// Service Worker起動時にもアラームを確認（フォールバック）
ensureAlarmsExist();

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

  chrome.contextMenus.create({
    id: 'addToMiteruyo',
    title: chrome.i18n.getMessage('addToMiteruyo') || 'Miteruyoに追加',
    contexts: ['link', 'page'],
    targetUrlPatterns: ['*://*.twitch.tv/*'],
    documentUrlPatterns: ['*://*.twitch.tv/*']
  });
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
        checkStreams();
      } else {
        console.log('Channel already exists:', channelName);
      }
    } catch (error) {
      console.error('Error adding from context menu:', error);
    }
  }
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  console.log('Alarm fired:', alarm.name);
  if (alarm.name === 'periodicalUpdate') {
    checkStreams();
  }
  if (alarm.name === 'tabRotationAlarm') {
    checkTabRotate();
  }
});

// tab Rotation の設定が変更されたときにアラームを更新
chrome.storage.onChanged.addListener(async (changes, area) => {
  await onStorageChangedForTabRotation(changes, area);
});

// ウィンドウが閉じられたときに lastOpenWindowId をクリア
chrome.windows.onRemoved.addListener(async (windowId) => {
  await onWindowRemoved(windowId);
});

chrome.tabs.onActivated.addListener(async activeInfo => {
  const targetWindowId = (await chrome.storage.local.get('lastOpenWindowId')).lastOpenWindowId;
  const enableTabMute = (await chrome.storage.local.get('isEnabledTabMute')).isEnabledTabMute;
  const enableAutoClose = (await chrome.storage.local.get('isEnabledAutoClose')).isEnabledAutoClose;

  if (activeInfo.windowId === targetWindowId) {
    console.log('activated', activeInfo, enableTabMute, enableAutoClose);
    if (enableTabMute) {
      chrome.tabs.query({ windowId: targetWindowId }, (tabs) => {
        tabs.forEach((tab) => {
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

// 通知クリック時のハンドラ
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('miteruyo-live-')) {
    const parts = notificationId.split('-');
    if (parts.length >= 3) {
      const channelName = parts[2];
      openInManagedWindow(channelName);
      chrome.notifications.clear(notificationId);
    }
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
