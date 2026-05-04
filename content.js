
let volumeInterval = null;

function stopVolumeInterval() {
  if (volumeInterval !== null) {
    clearInterval(volumeInterval);
    volumeInterval = null;
  }
}

// URLからチャンネル名を取得
function getChannelNameFromUrl() {
  const path = window.location.pathname;
  // 通常のチャンネルURL: /channelname
  // ポップアウトプレイヤー: /popout/channelname/chat
  const pathParts = path.split('/').filter(p => p);

  if (pathParts.length === 0) return null;

  if (pathParts[0] === 'popout' && pathParts.length >= 2) {
    return pathParts[1];
  }

  return pathParts[0];
}

// ストレージから設定を読み込んで音量を適用
async function applyVolumeSettings() {
  const channelName = getChannelNameFromUrl();
  if (!channelName) return;

  // 拡張機能のコンテキストが無効になっている場合は停止
  if (!chrome.runtime?.id) {
    stopVolumeInterval();
    return;
  }

  try {
    const data = await chrome.storage.local.get(['channels']);
    const channels = Array.isArray(data.channels) ? data.channels : [];

    // 現在のチャンネル情報を探す
    const channelInfo = channels.find(c =>
      c && typeof c.name === 'string' && c.name.toLowerCase() === channelName.toLowerCase()
    );

    console.log(`[Miteruyo] Checking volume for: ${channelName}`, { channelInfo });

    if (channelInfo && channelInfo.enableCustomVolume && channelInfo.customVolume !== undefined) {
      const targetVolume = parseInt(channelInfo.customVolume, 10);
      setVideoVolume(targetVolume);
    }
  } catch (error) {
    if (error.message.includes('Extension context invalidated')) {
      console.log('[Miteruyo] Extension context invalidated. Stopping script.');
      stopVolumeInterval();
      return;
    }
    console.error('[Miteruyo] Error:', error);
  }
}

function setVideoVolume(volumePercent) {
  // 0-100 を 0.0-1.0 に変換
  const volume = Math.min(Math.max(volumePercent, 0), 100) / 100;

  const videos = document.querySelectorAll('video');
  if (videos.length === 0) {
    console.log('[Miteruyo] No video element found.');
    return;
  }

  videos.forEach(video => {
    if (video.volume !== volume) {
      console.log(`[Miteruyo] Setting volume to ${volumePercent}% (${volume})`);
      video.volume = volume;
    }
  });
}

// ストレージ変更を監視して即時反映
chrome.storage.onChanged.addListener((changes) => {
  if (changes.channels) {
    console.log('[Miteruyo] Channels updated, re-applying volume.');
    applyVolumeSettings();
  }
});

// ページ遷移（SPA）を監視
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    // URLが変わったら少し待ってから適用（DOM更新待ち）
    setTimeout(applyVolumeSettings, 1000);
    setTimeout(applyVolumeSettings, 3000); // 念のため
  }
});
urlObserver.observe(document, { subtree: true, childList: true });

// クリーンアップ
function cleanup() {
  urlObserver.disconnect();
  stopVolumeInterval();
}

window.addEventListener('beforeunload', cleanup);

// 初回実行
setTimeout(applyVolumeSettings, 1000);
setTimeout(applyVolumeSettings, 3000);

// 定期的にチェック（プレイヤーが起動時にミュートされる場合などの対策）
volumeInterval = setInterval(applyVolumeSettings, 5000);
