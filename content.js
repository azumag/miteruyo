let currentChannel = '';
let currentCategory = '';

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

  const data = await chrome.storage.local.get(['channels', 'categoryVolumes']);
  const channels = data.channels || [];
  const categoryVolumes = parseCategoryVolumes(data.categoryVolumes || ''); // "Category:50, Other:30" -> Object

  // 現在のチャンネル情報を探す
  const channelInfo = channels.find(c => c.name.toLowerCase() === channelName.toLowerCase());
  
  // チャンネル情報がない、またはオフラインの場合は何もしない（カテゴリも不明なため）
  // ただし、Miteruyoに登録されていないチャンネルでも、カテゴリボリュームを適用したい場合は
  // DOMからカテゴリを取得する必要があるが、一旦登録チャンネルのみを対象とするか、
  // あるいはDOMから頑張って取得するか。
  // 一旦、Miteruyoの管理下にあるチャンネル（= background.jsが定期的に更新している）を優先する。
  
  let targetVolume = null;

  if (channelInfo) {
    // 1. チャンネル個別の設定を確認
    if (channelInfo.enableCustomVolume && channelInfo.customVolume !== undefined) {
      targetVolume = parseInt(channelInfo.customVolume, 10);
      console.log(`[Miteruyo] Applying channel volume: ${targetVolume}`);
    } 
    // 2. カテゴリ設定を確認
    else if (channelInfo.game_name) {
      // 大文字小文字を無視してマッチング
      const gameNameQuery = channelInfo.game_name.toLowerCase();
      // categoryVolumes のキーも小文字にして探す
      const matchCategory = Object.keys(categoryVolumes).find(k => k.toLowerCase() === gameNameQuery);
      if (matchCategory) {
        targetVolume = categoryVolumes[matchCategory];
        console.log(`[Miteruyo] Applying category volume (${matchCategory}): ${targetVolume}`);
      }
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
      // ミュートされている場合は解除などを検討するが、
      // ユーザーが意図的にミュートしている場合もあるので、とりあえず音量設定のみ行う
    }
  }
}

function parseCategoryVolumes(str) {
  if (!str) return {};
  // "Just Chatting:50, ASMR: 30"
  const result = {};
  str.split(',').forEach(part => {
    const [cat, vol] = part.split(':').map(s => s.trim());
    if (cat && vol && !isNaN(vol)) {
      result[cat] = parseInt(vol, 10);
    }
  });
  return result;
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
