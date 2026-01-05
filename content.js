let currentChannel = '';


// URLからチャンネル名を取得
function getChannelNameFromUrl() {
  const pathParts = window.location.pathname.split('/').filter(p => p);
  if (pathParts.length === 0) return null;
  return pathParts[0];
}

// ストレージから設定を読み込んで音量を適用
async function applyVolumeSettings() {
  const channelName = getChannelNameFromUrl();
  if (!channelName) return;

  const data = await chrome.storage.local.get(['channels']);
  const channels = data.channels || [];

  // 現在のチャンネル情報を探す
  const channelInfo = channels.find(c => c.name.toLowerCase() === channelName.toLowerCase());

  let targetVolume = null;

  if (channelInfo) {
    // 1. チャンネル個別の設定を確認
    if (channelInfo.enableCustomVolume && channelInfo.customVolume !== undefined) {
      targetVolume = parseInt(channelInfo.customVolume, 10);
      console.log(`[Miteruyo] Applying channel volume: ${targetVolume}`);
    }
  }

  if (targetVolume !== null) {
    setVideoVolume(targetVolume);
  }
}

function setVideoVolume(volumePercent) {
  // 0-100 を 0.0-1.0 に変換
  const volume = Math.min(Math.max(volumePercent, 0), 100) / 100;

  const video = document.querySelector('video');
  if (video) {
    if (video.volume !== volume) {
      video.volume = volume;
    }
  }
}

// ページ遷移（SPA）を監視
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    // URLが変わったら少し待ってから適用（DOM更新待ち）
    setTimeout(applyVolumeSettings, 1000);
    setTimeout(applyVolumeSettings, 3000); // 念のため
  }
}).observe(document, { subtree: true, childList: true });

// 初回実行
setTimeout(applyVolumeSettings, 1000);

// 定期的にチェック（プレイヤーが後からロードされる場合など）
setInterval(applyVolumeSettings, 5000);
