const loading = document.getElementById('loading');
const channelInput = document.getElementById('channelInput');
const addChannelBtn = document.getElementById('addChannelBtn');
const channelTable = document.getElementById('channelTableBody');
const enableSwitch = document.getElementById('enableSwitch');
const openNewWindow = document.getElementById('openNewWindow');
const enableTabRotation = document.getElementById('enableTabRotation');
const enableTabMute = document.getElementById('enableTabMute');
const enableAutoClose = document.getElementById('enableAutoClose');
const autoOpenOnce = document.getElementById('autoOpenOnce');
const tabRotationInterval = document.getElementById('tabRotationInterval');
const checkInterval = document.getElementById('checkInterval');
const enableMaxTabs = document.getElementById('enableMaxTabs');
const maxTabCount = document.getElementById('maxTabCount');
const skipBrandedContent = document.getElementById('skipBrandedContent');
const dynamicRotation = document.getElementById('dynamicRotation');
const allowedOnlyCategoriesTagList = document.getElementById('allowedOnlyCategoriesTagList');
const allowedOnlyCategoriesSearchContainer = document.getElementById('allowedOnlyCategoriesSearch');
const blockedCategoriesTagList = document.getElementById('blockedCategoriesTagList');
const blockedCategoriesSearchContainer = document.getElementById('blockedCategoriesSearch');

const loginTwitch = document.getElementById('loginTwitch');
const enableNotifications = document.getElementById('enableNotifications');
const aboutBtn = document.getElementById('aboutBtn');

const liveFilterSwitch = document.getElementById('liveFilterSwitch');

const clientId = 'lt060jwpltwp3weqdk53dx450aj99p';

// Migrate old nested token format { oauth_token: "token" } (object) to flat string "token"
function migrateOAuthToken(token) {
  if (token && typeof token === 'object' && token.oauth_token) {
    return token.oauth_token;
  }
  return token;
}

function normalizeStoredChannels(channels) {
  return Array.isArray(channels) ? channels : [];
}

function normalizeChannelName(channel) {
  return typeof channel?.name === 'string' ? channel.name.toLowerCase() : '';
}

function isSameChannel(channel, otherChannel) {
  const channelName = normalizeChannelName(channel);
  const otherChannelName = normalizeChannelName(otherChannel);
  return channelName !== '' && channelName === otherChannelName;
}

function normalizeCategoryList(categories) {
  if (!Array.isArray(categories)) return [];

  return categories
    .map(category => {
      if (typeof category === 'string') {
        return { id: null, name: category };
      }
      return category;
    })
    .filter(category =>
      category &&
      typeof category === 'object' &&
      typeof category.name === 'string' &&
      category.name.trim() !== ''
    );
}

function parseCategoryOptionValue(value) {
  try {
    const category = JSON.parse(value);
    if (!category || typeof category !== 'object' || typeof category.name !== 'string') {
      return null;
    }
    return category;
  } catch (error) {
    console.error('Failed to parse category:', error);
    return null;
  }
}

function normalizeCategoryName(category) {
  return typeof category?.name === 'string' ? category.name.trim().toLowerCase() : '';
}

function isSameCategory(category, otherCategory) {
  if (!category || !otherCategory) return false;
  if (category.id && otherCategory.id) return category.id === otherCategory.id;
  const categoryName = normalizeCategoryName(category);
  const otherCategoryName = normalizeCategoryName(otherCategory);
  return categoryName !== '' && categoryName === otherCategoryName;
}

function includesCategory(categories, category) {
  return categories.some(existingCategory => isSameCategory(existingCategory, category));
}

// Category search using Twitch API
async function searchCategories(query) {
  if (!query || query.length < 1) return [];

  const data = await chrome.storage.local.get('oauth_token');
  const token = migrateOAuthToken(data.oauth_token);
  if (!token) return [];

  const url = `https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent(query)}&first=10`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  const options = {
    headers: {
      'Client-ID': clientId,
      'Authorization': `Bearer ${token}`,
    },
    signal: controller.signal,
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) return [];
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Category search error:', error);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

// Create category search input with dropdown
// existingCategories is an array of {id, name} objects
function createCategorySearchInput(options) {
  const { onSelect, placeholder = chrome.i18n.getMessage('categorySearchDefaultPlaceholder'), existingCategories = [] } = options;

  const container = document.createElement('div');
  container.className = 'position-relative';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-control form-control-sm';
  input.placeholder = placeholder;

  const dropdown = document.createElement('div');
  dropdown.className = 'dropdown-menu w-100';
  dropdown.style.maxHeight = '200px';
  dropdown.style.overflowY = 'auto';

  container.appendChild(input);
  container.appendChild(dropdown);

  let searchTimer = null;

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = input.value.trim();

    if (query.length < 1) {
      dropdown.classList.remove('show');
      return;
    }

    searchTimer = setTimeout(async () => {
      const results = await searchCategories(query);
      dropdown.innerHTML = '';

      if (results.length === 0) {
        const noResult = document.createElement('div');
        noResult.className = 'dropdown-item disabled text-muted';
        noResult.textContent = chrome.i18n.getMessage('noResults');
        dropdown.appendChild(noResult);
      } else {
        results.forEach(cat => {
          // Skip if already in the list.
          if (includesCategory(existingCategories, cat)) return;

          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'dropdown-item d-flex align-items-center';

          if (cat.box_art_url) {
            const img = document.createElement('img');
            img.src = cat.box_art_url.replace('{width}', '20').replace('{height}', '27');
            img.className = 'me-2';
            img.style.width = '20px';
            img.style.height = '27px';
            item.appendChild(img);
          }

          const name = document.createElement('span');
          name.textContent = cat.name;
          item.appendChild(name);

          item.addEventListener('click', () => {
            // Pass both id and name
            onSelect({ id: cat.id, name: cat.name });
            input.value = '';
            dropdown.classList.remove('show');
          });

          dropdown.appendChild(item);
        });
      }

      dropdown.classList.add('show');
    }, 300);
  });

  // Close dropdown when clicking outside
  const abortController = new AbortController();
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      dropdown.classList.remove('show');
    }
  }, { signal: abortController.signal });

  container.cleanup = () => {
    abortController.abort();
  };

  // Update existing categories reference (array of {id, name})
  container.updateExistingCategories = (categories) => {
    existingCategories.length = 0;
    existingCategories.push(...categories);
  };

  return container;
}

// For debugging
// chrome.storage.local.get(null, (data) => {
//   console.log({ local: data });
// });
// chrome.storage.sync.get(null, (data) => {
//   console.log({ sync: data });
// });

// i18n
document.addEventListener('DOMContentLoaded', function () {
  const enableOpenMessage = chrome.i18n.getMessage('enableOpen');
  const channelPlaceholderMessage = chrome.i18n.getMessage('channelAddPlaceholder');
  const addChannelBtnMessage = chrome.i18n.getMessage('channelAddBtn');
  const showOnlyLiveMessage = chrome.i18n.getMessage('showOnlyLive');
  const settingsMessage = chrome.i18n.getMessage('settings');

  document.querySelector('label[for="enableSwitch"]').textContent = enableOpenMessage;
  document.getElementById('channelInput').placeholder = channelPlaceholderMessage;
  document.getElementById('addChannelBtn').textContent = addChannelBtnMessage;
  document.querySelector('label[for="liveFilterSwitch"]').textContent = showOnlyLiveMessage;
  document.querySelector('button[aria-controls="collapseConfig"]').textContent = settingsMessage;

  const channelInputLabel = document.querySelector('label[for="channelInput"]');
  if (channelInputLabel) channelInputLabel.textContent = chrome.i18n.getMessage('channelInputLabel') || 'Channel name';

  const invalidChannelFeedback = document.querySelector('.invalid-feedback[data-i18n="invalidChannelName"]');
  if (invalidChannelFeedback) invalidChannelFeedback.textContent = chrome.i18n.getMessage('invalidChannelName');

  // 新しいウィンドウで開く
  const openNewWindowMessage = chrome.i18n.getMessage('openNewWindow');
  document.querySelector('label[for="openNewWindow"]').textContent = openNewWindowMessage;
  // 開くタブ数を制限
  const enableMaxTabsMessage = chrome.i18n.getMessage('enableMaxTabs');
  document.querySelector('label[for="enableMaxTabs"]').textContent = enableMaxTabsMessage;
  const maxTabUnitMessage = chrome.i18n.getMessage('maxTabUnit');
  document.getElementById('maxTabUnit').textContent = maxTabUnitMessage;
  // 複数タブ自動切り替え
  const enableTabRotationMessage = chrome.i18n.getMessage('enableTabRotation');
  document.querySelector('label[for="enableTabRotation"]').textContent = enableTabRotationMessage;
  // 分
  const minutesMessage = chrome.i18n.getMessage('minutes');
  document.getElementById('rotationUnit').textContent = minutesMessage;
  // タブ数で分割
  const dynamicRotationMessage = chrome.i18n.getMessage('dynamicRotation');
  if (dynamicRotationMessage) {
    document.querySelector('label[for="dynamicRotation"]').textContent = dynamicRotationMessage;
  }
  // チェック間隔
  const checkIntervalMessage = chrome.i18n.getMessage('checkInterval');
  document.querySelector('label[for="checkInterval"]').textContent = checkIntervalMessage;
  document.getElementById('checkIntervalUnit').textContent = minutesMessage;
  // 非アクティブタブ自動ミュート
  const enableTabMuteMessage = chrome.i18n.getMessage('enableTabMute');
  document.querySelector('label[for="enableTabMute"]').textContent = enableTabMuteMessage;
  // オフラインチャネル自動閉じ
  const enableAutoCloseMessage = chrome.i18n.getMessage('enableAutoClose');
  document.querySelector('label[for="enableAutoClose"]').textContent = enableAutoCloseMessage;
  // 一度開いたら再度開かない
  const autoOpenOnceMessage = chrome.i18n.getMessage('autoOpenOnce');
  document.querySelector('label[for="autoOpenOnce"]').textContent = autoOpenOnceMessage;
  // プロモーション配信を開かない
  const skipBrandedContentMessage = chrome.i18n.getMessage('skipBrandedContent');
  document.querySelector('label[for="skipBrandedContent"]').textContent = skipBrandedContentMessage;
  // このカテゴリだけを開く
  const allowedOnlyCategoriesMessage = chrome.i18n.getMessage('allowedOnlyCategories');
  if (allowedOnlyCategoriesMessage) {
    document.getElementById('allowedOnlyCategoriesLabel').textContent = allowedOnlyCategoriesMessage;
  }
  // 開かないカテゴリ
  const blockedCategoriesMessage = chrome.i18n.getMessage('blockedCategories');
  document.getElementById('blockedCategoriesLabel').textContent = blockedCategoriesMessage;

  // 配信開始時にデスクトップ通知
  const enableNotificationsMessage = chrome.i18n.getMessage('enableNotifications');
  document.querySelector('label[for="enableNotifications"]').textContent = enableNotificationsMessage;

  // Aboutラベル
  const aboutLabel = document.getElementById('aboutLabel');
  if (aboutLabel) aboutLabel.textContent = chrome.i18n.getMessage('about');

  // モーダル内の多言語対応
  const aboutModalLabel = document.getElementById('aboutModalLabel');
  if (aboutModalLabel) aboutModalLabel.textContent = chrome.i18n.getMessage('about');

  const githubLinkLabel = document.getElementById('githubLinkLabel');
  if (githubLinkLabel) {
    const icon = document.createElement('i');
    icon.className = 'bi bi-github';
    githubLinkLabel.textContent = '';
    githubLinkLabel.appendChild(icon);
    githubLinkLabel.appendChild(document.createTextNode(' ' + chrome.i18n.getMessage('githubLink')));
  }

  const supportMessageLabel = document.getElementById('supportMessageLabel');
  if (supportMessageLabel) supportMessageLabel.textContent = chrome.i18n.getMessage('supportMessage');

  // バージョン情報の設定
  const aboutVersion = document.getElementById('aboutVersion');
  if (aboutVersion) {
    const manifest = chrome.runtime.getManifest();
    aboutVersion.textContent = `v${manifest.version}`;
  }

  // 通知ヘルプアイコン
  const notificationHelpIcon = document.getElementById('notificationHelpIcon');
  if (notificationHelpIcon) {
    const notificationHelpMessage = chrome.i18n.getMessage('notificationHelp');
    notificationHelpIcon.setAttribute('title', notificationHelpMessage);
    notificationHelpIcon.setAttribute('aria-label', notificationHelpMessage);
  }

  // カテゴリ設定のヘルプアイコン
  const allowedOnlyCategoriesHelpIcon = document.getElementById('allowedOnlyCategoriesHelpIcon');
  if (allowedOnlyCategoriesHelpIcon) {
    const msg = chrome.i18n.getMessage('allowedOnlyCategoriesHelp');
    allowedOnlyCategoriesHelpIcon.setAttribute('data-bs-title', msg);
    allowedOnlyCategoriesHelpIcon.setAttribute('aria-label', msg);
  }

  const blockedCategoriesHelpIcon = document.getElementById('blockedCategoriesHelpIcon');
  if (blockedCategoriesHelpIcon) {
    const msg = chrome.i18n.getMessage('blockedCategoriesHelp');
    blockedCategoriesHelpIcon.setAttribute('data-bs-title', msg);
    blockedCategoriesHelpIcon.setAttribute('aria-label', msg);
  }

  // ウィンドウ高さが600px未満なら設定アコーディオンを開く
  if (window.innerHeight < 600) {
    const collapseConfig = document.getElementById('collapseConfig');
    if (collapseConfig) {
      new bootstrap.Collapse(collapseConfig, {
        toggle: false
      }).show();
    }
  }

  // Tooltipの初期化
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });
});

// Global state for blocked categories (array of {id, name} objects)
let globalBlockedCategories = [];
// Global state for allowed-only categories (array of {id, name} objects)
let globalAllowedOnlyCategories = [];
// Cleanup functions for channel rows (called on refreshList or channel removal)
const channelCleanups = [];

// Render category tags (shared implementation for DRY)
function renderCategoryTags({ container, categories, badgeClass, onDelete }) {
  container.innerHTML = '';
  normalizeCategoryList(categories).forEach(cat => {
    const tag = document.createElement('span');
    tag.className = `badge ${badgeClass} d-flex align-items-center`;
    tag.textContent = cat.name;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-close btn-close-white ms-1';
    deleteBtn.style.fontSize = '0.6em';
    deleteBtn.addEventListener('click', () => onDelete(cat));

    tag.appendChild(deleteBtn);
    container.appendChild(tag);
  });
}

// Migrate old formats to new {id, name} array format
async function migrateBlockedCategories() {
  const data = await chrome.storage.local.get(['blockedCategoryNames', 'blockedCategoryList']);

  if (Array.isArray(data.blockedCategoryList)) {
    const migrated = normalizeCategoryList(data.blockedCategoryList);
    const alreadyNormalized = migrated.length === data.blockedCategoryList.length &&
      migrated.every((category, index) => category === data.blockedCategoryList[index]);

    if (alreadyNormalized) {
      return data.blockedCategoryList;
    }

    await chrome.storage.local.set({ blockedCategoryList: migrated });
    return migrated;
  }

  // Migrate from old comma-separated format
  if (data.blockedCategoryNames && typeof data.blockedCategoryNames === 'string') {
    const categories = data.blockedCategoryNames
      .replace(/\\,/g, '__M_COMMA__')
      .split(',')
      .map(c => c.replace(/__M_COMMA__/g, ',').trim())
      .filter(c => c)
      .map(name => ({ id: null, name })); // id is null for legacy data
    await chrome.storage.local.set({ blockedCategoryList: categories });
    return categories;
  }

  return [];
}

// Migrate allowed-only categories to new format
async function migrateAllowedOnlyCategories() {
  const data = await chrome.storage.local.get(['allowedOnlyCategoryList']);

  if (Array.isArray(data.allowedOnlyCategoryList)) {
    const migrated = normalizeCategoryList(data.allowedOnlyCategoryList);
    const alreadyNormalized = migrated.length === data.allowedOnlyCategoryList.length &&
      migrated.every((category, index) => category === data.allowedOnlyCategoryList[index]);

    if (alreadyNormalized) {
      return data.allowedOnlyCategoryList;
    }

    await chrome.storage.local.set({ allowedOnlyCategoryList: migrated });
    return migrated;
  }

  return [];
}

// Render global allowed-only categories tag list
function renderGlobalAllowedOnlyTags() {
  renderCategoryTags({
    container: allowedOnlyCategoriesTagList,
    categories: globalAllowedOnlyCategories,
    badgeClass: 'bg-success',
    onDelete: (cat) => {
      globalAllowedOnlyCategories = globalAllowedOnlyCategories.filter(c => c.id !== cat.id || c.name !== cat.name);
      chrome.storage.local.set({ allowedOnlyCategoryList: globalAllowedOnlyCategories });
      renderGlobalAllowedOnlyTags();
      globalAllowedOnlyCategorySearch?.updateExistingCategories(globalAllowedOnlyCategories);
      updateGlobalCategoryUIState();
    }
  });
}

// Update UI state based on allowed-only categories
function updateGlobalCategoryUIState() {
  const hasAllowedOnly = globalAllowedOnlyCategories.length > 0;

  // グレーアウト: 除外カテゴリの設定
  blockedCategoriesTagList.style.opacity = hasAllowedOnly ? '0.5' : '1';
  blockedCategoriesSearchContainer.style.opacity = hasAllowedOnly ? '0.5' : '1';
  if (globalCategorySearch) {
    const input = blockedCategoriesSearchContainer.querySelector('input');
    if (input) input.disabled = hasAllowedOnly;
  }
}

// Render global blocked categories tag list
function renderGlobalBlockedTags() {
  renderCategoryTags({
    container: blockedCategoriesTagList,
    categories: globalBlockedCategories,
    badgeClass: 'bg-danger',
    onDelete: (cat) => {
      globalBlockedCategories = globalBlockedCategories.filter(c => c.id !== cat.id || c.name !== cat.name);
      chrome.storage.local.set({ blockedCategoryList: globalBlockedCategories });
      renderGlobalBlockedTags();
      globalCategorySearch?.updateExistingCategories(globalBlockedCategories);
    }
  });
}

// Global category search instances
let globalCategorySearch = null;
let globalAllowedOnlyCategorySearch = null;

chrome.storage.local.get(
  {
    channels: [],
    isEnabled: false,
    isOpenNewWindow: false,
    isOpenMultiTwitch: false,
    isLiveFilter: false,
    oauth_token: null,
    tabRotationInterval: 5,
    checkInterval: 1,
    isEnabledTabRotation: false,
    isEnabledMaxTabs: false,
    maxTabCount: 5,
    isEnabledTabMute: false,
    isEnabledAutoClose: false,
    isAutoOpenOnce: false,
    isSkipBrandedContent: false,
    isDynamicRotation: false,
    isEnabledNotifications: false, // Added this line
  },
  async (data) => {
    loading.hidden = false;

    enableSwitch.checked = data.isEnabled;
    openNewWindow.checked = data.isOpenNewWindow;
    liveFilterSwitch.checked = data.isLiveFilter;
    tabRotationInterval.value = data.tabRotationInterval;
    checkInterval.value = data.checkInterval;
    enableTabMute.checked = data.isEnabledTabMute;
    enableTabRotation.checked = data.isEnabledTabRotation;
    enableMaxTabs.checked = data.isEnabledMaxTabs;
    maxTabCount.value = data.maxTabCount;
    enableAutoClose.checked = data.isEnabledAutoClose;
    autoOpenOnce.checked = data.isAutoOpenOnce;
    skipBrandedContent.checked = data.isSkipBrandedContent;
    dynamicRotation.checked = data.isDynamicRotation;
    enableNotifications.checked = data.isEnabledNotifications; // Added this line

    // Initialize global allowed-only categories
    globalAllowedOnlyCategories = await migrateAllowedOnlyCategories();
    renderGlobalAllowedOnlyTags();

    // Setup allowed-only category search
    globalAllowedOnlyCategorySearch = createCategorySearchInput({
      onSelect: (category) => {
        // category is {id, name} object
        if (!includesCategory(globalAllowedOnlyCategories, category)) {
          globalAllowedOnlyCategories.push(category);
          chrome.storage.local.set({ allowedOnlyCategoryList: globalAllowedOnlyCategories });
          renderGlobalAllowedOnlyTags();
          globalAllowedOnlyCategorySearch.updateExistingCategories(globalAllowedOnlyCategories);
          updateGlobalCategoryUIState();
        }
      },
      placeholder: chrome.i18n.getMessage('categorySearchPlaceholder'),
      existingCategories: [...globalAllowedOnlyCategories],
    });
    allowedOnlyCategoriesSearchContainer.appendChild(globalAllowedOnlyCategorySearch);

    // Initialize global blocked categories
    globalBlockedCategories = await migrateBlockedCategories();
    renderGlobalBlockedTags();

    // Setup category search
    globalCategorySearch = createCategorySearchInput({
      onSelect: (category) => {
        // category is {id, name} object
        if (!includesCategory(globalBlockedCategories, category)) {
          globalBlockedCategories.push(category);
          chrome.storage.local.set({ blockedCategoryList: globalBlockedCategories });
          renderGlobalBlockedTags();
          globalCategorySearch.updateExistingCategories(globalBlockedCategories);
        }
      },
      placeholder: chrome.i18n.getMessage('categorySearchPlaceholder'),
      existingCategories: [...globalBlockedCategories],
    });
    blockedCategoriesSearchContainer.appendChild(globalCategorySearch);

    // Update UI state based on allowed-only categories
    updateGlobalCategoryUIState();

    const migratedToken = migrateOAuthToken(data.oauth_token);
    // Persist migrated token if format changed
    if (migratedToken && data.oauth_token !== migratedToken) {
      await chrome.storage.local.set({ oauth_token: migratedToken });
    }
    if (migratedToken) {
      const connected = await checkTwitchConnection(migratedToken);
      if (connected) updateList(normalizeStoredChannels(data.channels));
    } else {
      rewriteNeedsLoginButton(false);
    }

    loading.hidden = true;
  }
);

async function updateList(dchannels) {
  const checkStreams = [];
  for (const _channel of normalizeStoredChannels(dchannels)) {
    checkStreams.push(
      checkStream(_channel)
        .then((channel) => {
          if (channel) {
            addChannelToList(channel);
            return channel;
          }
        })
    );
  }
  try {
    const channels = await Promise.all(checkStreams);
    chrome.storage.local.set({ channels });
  } catch (error) {
    console.error('updateList error:', error);
  }
}

async function addChannelToList(channel, newAdded = false) {
  if (!newAdded && channel.status !== 'error' && liveFilterSwitch.checked && !channel.onLive) return;

  let cleanupFn;

  const pauseMsg = chrome.i18n.getMessage('pause');

  const tr = document.createElement('tr');
  tr.className = 'align-middle'; // Ensure vertical centering
  tr.classList.add('channel-tr');

  // 1. Live Status & On/Off Switch
  const statusTd = document.createElement('td');
  const statusContainer = document.createElement('div');
  statusContainer.className = 'd-flex align-items-center gap-1';
  statusTd.appendChild(statusContainer);
  tr.appendChild(statusTd);

  const openButton = document.createElement('button');
  statusContainer.appendChild(openButton);

  if (channel.onLive) {
    openButton.textContent = channel.onLiveOpen ? chrome.i18n.getMessage('statusLive') : pauseMsg;
    openButton.setAttribute('class', 'btn btn-outline-success btn-sm');
    openButton.style.width = '72px';
    openButton.addEventListener('click', () => {
      openInManagedWindow(channel.name);
    });
  } else {
    openButton.textContent = channel.onLiveOpen ? chrome.i18n.getMessage('statusOffline') : pauseMsg;
    openButton.setAttribute('class', 'btn btn-outline-danger btn-sm');
    openButton.style.width = '72px';
  }

  if (channel.status === 'error') {
    openButton.textContent = chrome.i18n.getMessage('statusNotFound');
    openButton.setAttribute('class', 'btn btn-outline-danger btn-sm');
    openButton.style.width = '72px';
  }

  // On/Off Switch
  const onLiveOpenSwitch = document.createElement('button');
  const pauseIcon = document.createElement('i');
  onLiveOpenSwitch.setAttribute('class', channel.onLiveOpen ? 'btn btn-outline-primary btn-sm' : 'btn btn-outline-danger btn-sm');
  pauseIcon.setAttribute('class', channel.onLiveOpen ? 'bi bi-pause' : 'bi bi-play');
  onLiveOpenSwitch.appendChild(pauseIcon);

  onLiveOpenSwitch.addEventListener('click', () => {
    channel.onLiveOpen = !channel.onLiveOpen;
    pauseIcon.setAttribute('class', channel.onLiveOpen ? 'bi bi-pause' : 'bi bi-play');
    onLiveOpenSwitch.setAttribute('class', channel.onLiveOpen ? 'btn btn-outline-primary btn-sm' : 'btn btn-outline-danger btn-sm');
    saveChannelToList(channel);

    if (channel.snoozed) return; // スヌーズ中はopenButtonを変更しない

    if (channel.onLive) {
      openButton.textContent = channel.onLiveOpen ? chrome.i18n.getMessage('statusLive') : pauseMsg;
      openButton.setAttribute('class', 'btn btn-outline-success btn-sm');
      openButton.style.width = '72px';
      openButton.addEventListener('click', () => {
        openInManagedWindow(channel.name);
      });
    } else {
      openButton.textContent = channel.onLiveOpen ? chrome.i18n.getMessage('statusOffline') : pauseMsg;
      openButton.setAttribute('class', 'btn btn-outline-danger btn-sm');
      openButton.style.width = '72px';
    }
  });

  if (channel.status !== 'error') {
    statusContainer.appendChild(onLiveOpenSwitch);
  }

  // Snooze Button (ライブ中かつエラーでない場合のみ表示)
  if (channel.onLive && channel.status !== 'error') {
    const snoozeBtn = document.createElement('button');
    const snoozeIcon = document.createElement('i');
    const updateSnoozeUI = () => {
      snoozeBtn.setAttribute('class', channel.snoozed ? 'btn btn-warning btn-sm' : 'btn btn-outline-secondary btn-sm');
      snoozeIcon.setAttribute('class', channel.snoozed ? 'bi bi-moon-fill' : 'bi bi-moon');
      snoozeBtn.title = channel.snoozed ? chrome.i18n.getMessage('snoozed') : chrome.i18n.getMessage('snooze');
      if (channel.snoozed) {
        openButton.textContent = chrome.i18n.getMessage('snoozed');
        openButton.setAttribute('class', 'btn btn-outline-warning btn-sm');
        openButton.style.width = '72px';
      }
    };
    snoozeBtn.appendChild(snoozeIcon);
    updateSnoozeUI();

    snoozeBtn.addEventListener('click', () => {
      channel.snoozed = !channel.snoozed;
      updateSnoozeUI();
      if (!channel.snoozed && channel.onLive) {
        openButton.textContent = channel.onLiveOpen ? chrome.i18n.getMessage('statusLive') : pauseMsg;
        openButton.setAttribute('class', 'btn btn-outline-success btn-sm');
        openButton.style.width = '72px';
      }
      saveChannelToList(channel);
    });

    statusContainer.appendChild(snoozeBtn);
  }

  // Priority Toggle Button (エラーでない場合のみ表示)
  if (channel.status !== 'error') {
    const priorityBtn = document.createElement('button');
    const priorityIcon = document.createElement('i');
    const updatePriorityUI = () => {
      priorityBtn.setAttribute('class', channel.isPriority ? 'btn btn-warning btn-sm' : 'btn btn-outline-secondary btn-sm');
      priorityIcon.setAttribute('class', channel.isPriority ? 'bi bi-star-fill' : 'bi bi-star');
      const priorityTooltip = channel.isPriority ? chrome.i18n.getMessage('priorityOn') : chrome.i18n.getMessage('priorityOff');
      priorityBtn.title = priorityTooltip;
      priorityBtn.setAttribute('aria-label', priorityTooltip);
    };
    priorityBtn.appendChild(priorityIcon);
    updatePriorityUI();

    priorityBtn.addEventListener('click', () => {
      channel.isPriority = !channel.isPriority;
      updatePriorityUI();
      saveChannelToList(channel);
    });

    statusContainer.appendChild(priorityBtn);
  }

  // 3. Channel Name
  const cntd = document.createElement('td');
  // Essential for text-overflow in table cells
  cntd.style.maxWidth = '0';
  cntd.style.width = '100%';
  cntd.style.whiteSpace = 'nowrap';
  cntd.style.overflow = 'hidden';
  cntd.style.textOverflow = 'ellipsis';

  const channelNameTag = document.createElement('span');
  channelNameTag.textContent = channel.name;
  channelNameTag.title = channel.name; // Tooltip
  cntd.appendChild(channelNameTag);
  tr.appendChild(cntd);

  // 4. Actions (Settings & Delete)
  const removetd = document.createElement('td');
  removetd.className = 'text-end';

  // Settings Button
  const settingsBtn = document.createElement('i');
  settingsBtn.className = 'bi bi-gear me-2';
  settingsBtn.style.cursor = 'pointer';
  settingsBtn.onclick = () => {
    const nextRow = tr.nextSibling;
    if (nextRow && nextRow.classList.contains('settings-tr')) {
      nextRow.hidden = !nextRow.hidden;
    }
  };
  removetd.appendChild(settingsBtn);

  // Remove Button
  const removeButton = document.createElement('i');
  removeButton.className = 'bi bi-trash';
  removeButton.style.cursor = 'pointer';
  removeButton.addEventListener('click', () => {
    const confirmMessage = chrome.i18n.getMessage('confirmDelete', channel.name);
    if (window.confirm(confirmMessage)) {
      // Remove settings row if exists
      const nextRow = tr.nextSibling;
      if (nextRow && nextRow.classList.contains('settings-tr')) {
        nextRow.remove();
      }
      tr.remove();
      removeChannel(channel);
      // Cleanup listeners
      if (cleanupFn) {
        cleanupFn();
        const idx = channelCleanups.indexOf(cleanupFn);
        if (idx !== -1) channelCleanups.splice(idx, 1);
      }
    }
  });
  removetd.appendChild(removeButton);
  tr.appendChild(removetd);

  channelTable.appendChild(tr);

  // --- Settings Row ---
  const settingsTr = document.createElement('tr');
  settingsTr.classList.add('settings-tr');
  settingsTr.hidden = true;

  const settingsTd = document.createElement('td');
  settingsTd.colSpan = 3;
  settingsTd.className = 'bg-light p-2';

  // Function to toggle opacity/disabled state
  const toggleState = (isEnabled, elements) => {
    elements.forEach(el => {
      if ('disabled' in el) el.disabled = !isEnabled;
      el.style.opacity = isEnabled ? '1' : '0.5';
    });
  };

  // Custom Volume Control
  const volContainer = document.createElement('div');
  volContainer.className = 'd-flex align-items-center mb-3';

  const volCheck = document.createElement('input');
  volCheck.type = 'checkbox';
  volCheck.className = 'form-check-input me-2 flex-shrink-0';
  volCheck.style.width = '1.2em';
  volCheck.style.height = '1.2em';
  volCheck.id = `vol-check-${channel.name}`;
  volCheck.checked = !!channel.enableCustomVolume;

  const volLabel = document.createElement('label');
  volLabel.className = 'form-check-label me-3 small flex-shrink-0';
  volLabel.style.whiteSpace = 'nowrap';
  volLabel.htmlFor = `vol-check-${channel.name}`;
  volLabel.textContent = chrome.i18n.getMessage('volumeLabel');

  const volRange = document.createElement('input');
  volRange.type = 'range';
  volRange.className = 'form-range me-2 flex-grow-1';
  // Removed fixed width: 100px

  volRange.min = 0;
  volRange.max = 100;
  volRange.value = channel.customVolume !== undefined ? channel.customVolume : 100;

  const volValue = document.createElement('span');
  volValue.className = 'small';
  volValue.textContent = `${volRange.value}%`;

  // Apply initial volume state
  toggleState(volCheck.checked, [volRange, volValue]);

  // Append volume UI elements to container
  volContainer.appendChild(volCheck);
  volContainer.appendChild(volLabel);
  volContainer.appendChild(volRange);
  volContainer.appendChild(volValue);

  settingsTd.appendChild(volContainer);

  // Event Listeners for Volume
  volCheck.addEventListener('change', () => {
    channel.enableCustomVolume = volCheck.checked;
    if (!volCheck.checked) {
      channel.customVolume = 100;
      volRange.value = 100;
      volValue.textContent = '100%';
    }
    toggleState(volCheck.checked, [volRange, volValue]);
    saveChannelToList(channel);
  });

  volRange.addEventListener('input', () => {
    volValue.textContent = `${volRange.value}%`;
  });

  volRange.addEventListener('change', () => {
    channel.customVolume = parseInt(volRange.value, 10);
    saveChannelToList(channel);
  });

  // Add separator after volume
  const volSeparator = document.createElement('hr');
  volSeparator.className = 'my-2';
  settingsTd.appendChild(volSeparator);

  // --- Branded Content Settings ---
  const brandedContainer = document.createElement('div');
  brandedContainer.className = 'mb-1';

  const brandedLabel = document.createElement('div');
  brandedLabel.className = 'small mb-1';
  brandedLabel.textContent = chrome.i18n.getMessage('brandedContentLabel');
  brandedContainer.appendChild(brandedLabel);

  const brandedRadioGroup = document.createElement('div');
  brandedRadioGroup.className = 'ps-3'; // Slight indentation

  const createBrandedRadio = (id, value, labelText) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-check mb-1';
    const input = document.createElement('input');
    input.type = 'radio';
    input.className = 'form-check-input';
    input.name = `branded-${channel.name}`;
    input.id = `branded-${id}-${channel.name}`;
    input.value = value;
    const label = document.createElement('label');
    label.className = 'form-check-label small';
    label.htmlFor = `branded-${id}-${channel.name}`;
    label.textContent = labelText;
    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return { wrapper, input };
  };

  const { wrapper: openWrapper, input: radioOpenInput } = createBrandedRadio('open', 'open', chrome.i18n.getMessage('brandedOpen'));
  const { wrapper: blockWrapper, input: radioBlockInput } = createBrandedRadio('block', 'block', chrome.i18n.getMessage('brandedBlock'));
  const { wrapper: globalWrapper, input: radioGlobalInput } = createBrandedRadio('global', 'global', chrome.i18n.getMessage('brandedGlobal'));

  const brandedSetting = channel.brandedContentSetting || 'global';
  radioGlobalInput.checked = brandedSetting === 'global';
  radioOpenInput.checked = brandedSetting === 'open';
  radioBlockInput.checked = brandedSetting === 'block';

  brandedRadioGroup.appendChild(globalWrapper);
  brandedRadioGroup.appendChild(openWrapper);
  brandedRadioGroup.appendChild(blockWrapper);

  brandedContainer.appendChild(brandedRadioGroup);
  settingsTd.appendChild(brandedContainer);

  const brandedChangeHandler = () => {
    if (radioGlobalInput.checked) channel.brandedContentSetting = 'global';
    else if (radioOpenInput.checked) channel.brandedContentSetting = 'open';
    else if (radioBlockInput.checked) channel.brandedContentSetting = 'block';
    saveChannelToList(channel);
  };
  radioGlobalInput.addEventListener('change', brandedChangeHandler);
  radioOpenInput.addEventListener('change', brandedChangeHandler);
  radioBlockInput.addEventListener('change', brandedChangeHandler);

  // --- Notification Settings ---
  const notifyContainer = document.createElement('div');
  notifyContainer.className = 'mb-1';

  const notifyLabel = document.createElement('div');
  notifyLabel.className = 'small mb-1';
  notifyLabel.textContent = chrome.i18n.getMessage('notificationSetting');
  notifyContainer.appendChild(notifyLabel);

  const notifyRadioGroup = document.createElement('div');
  notifyRadioGroup.className = 'ps-3';

  const createNotifyRadio = (id, value, labelText) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-check mb-1';
    const input = document.createElement('input');
    input.type = 'radio';
    input.className = 'form-check-input';
    input.name = `notify-${channel.name}`;
    input.id = `notify-${id}-${channel.name}`;
    input.value = value;
    const label = document.createElement('label');
    label.className = 'form-check-label small';
    label.htmlFor = `notify-${id}-${channel.name}`;
    label.textContent = labelText;
    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return { wrapper, input };
  };

  const { wrapper: notifyGlobalWrapper, input: notifyGlobalInput } = createNotifyRadio('global', 'global', chrome.i18n.getMessage('notificationGlobal'));
  const { wrapper: notifyOnWrapper, input: notifyOnInput } = createNotifyRadio('on', 'on', chrome.i18n.getMessage('notificationOn'));
  const { wrapper: notifyOffWrapper, input: notifyOffInput } = createNotifyRadio('off', 'off', chrome.i18n.getMessage('notificationOff'));

  const notifySetting = channel.notificationSetting || 'global';
  notifyGlobalInput.checked = notifySetting === 'global';
  notifyOnInput.checked = notifySetting === 'on';
  notifyOffInput.checked = notifySetting === 'off';

  notifyRadioGroup.appendChild(notifyGlobalWrapper);
  notifyRadioGroup.appendChild(notifyOnWrapper);
  notifyRadioGroup.appendChild(notifyOffWrapper);

  notifyContainer.appendChild(notifyRadioGroup);
  // notifyContainer will be appended later in correct order

  const notifyChangeHandler = () => {
    if (notifyGlobalInput.checked) channel.notificationSetting = 'global';
    else if (notifyOnInput.checked) channel.notificationSetting = 'on';
    else if (notifyOffInput.checked) channel.notificationSetting = 'off';
    saveChannelToList(channel);
  };
  notifyGlobalInput.addEventListener('change', notifyChangeHandler);
  notifyOnInput.addEventListener('change', notifyChangeHandler);
  notifyOffInput.addEventListener('change', notifyChangeHandler);

  // Separator after notification settings
  const notifySeparator = document.createElement('hr');
  notifySeparator.className = 'my-2';
  // notifySeparator will be appended later in correct order

  // --- Allow Categories Settings (override global blocked) ---
  const allowContainer = document.createElement('div');
  allowContainer.className = 'mb-1';

  const allowLabelDiv = document.createElement('div');
  allowLabelDiv.className = 'd-flex justify-content-between align-items-center mb-1';

  const allowLabel = document.createElement('span');
  allowLabel.className = 'small';
  allowLabel.textContent = chrome.i18n.getMessage('allowedCategoriesException');

  const allowHelpIcon = document.createElement('i');
  allowHelpIcon.className = 'bi bi-question-circle-fill text-muted';
  allowHelpIcon.style.cursor = 'help';
  allowHelpIcon.setAttribute('data-bs-toggle', 'tooltip');
  allowHelpIcon.setAttribute('data-bs-title', chrome.i18n.getMessage('allowedCategoriesExceptionHelp'));
  new bootstrap.Tooltip(allowHelpIcon, { trigger: 'hover click' });

  allowLabelDiv.appendChild(allowLabel);
  allowLabelDiv.appendChild(allowHelpIcon);
  allowContainer.appendChild(allowLabelDiv);

  const allowContentDiv = document.createElement('div');
  allowContentDiv.className = 'ps-3';

  // Tag list container
  const allowTagList = document.createElement('div');
  allowTagList.className = 'd-flex flex-wrap gap-1 mb-1';

  // Dropdown for adding
  const allowDropdown = document.createElement('select');
  allowDropdown.className = 'form-select form-select-sm';
  allowDropdown.id = `allowCats-dropdown-${channel.name}`;

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = chrome.i18n.getMessage('addPlaceholder');
  defaultOption.disabled = true;
  defaultOption.selected = true;
  allowDropdown.appendChild(defaultOption);

  // Current allowed categories (array of {id, name} or legacy string array)
  // Migrate legacy format if needed
  let currentAllowed = normalizeCategoryList(channel.allowedCategoryList);
  if (currentAllowed.length > 0 && Array.isArray(channel.allowedCategoryList) && typeof channel.allowedCategoryList[0] === 'string') {
    channel.allowedCategoryList = currentAllowed;
    saveChannelToList(channel);
  }
  if (currentAllowed.length === 0 && Array.isArray(channel.allowedCategories)) {
    // Migrate from old string array format
    currentAllowed = normalizeCategoryList(channel.allowedCategories);
    channel.allowedCategoryList = currentAllowed;
    saveChannelToList(channel);
  }

  // Function to render the tag list
  const renderAllowTags = () => {
    renderCategoryTags({
      container: allowTagList,
      categories: currentAllowed,
      badgeClass: 'bg-success',
      onDelete: (cat) => {
        currentAllowed = currentAllowed.filter(c => c.id !== cat.id || c.name !== cat.name);
        channel.allowedCategoryList = currentAllowed;
        saveChannelToList(channel);
        renderAllowTags();
        updateDropdownOptions();
      }
    });
  };

  // Function to update dropdown options (from global blocked list)
  const updateDropdownOptions = () => {
    // Clear existing options except the first one
    while (allowDropdown.options.length > 1) {
      allowDropdown.remove(1);
    }

    chrome.storage.local.get('blockedCategoryList', (data) => {
      const categories = normalizeCategoryList(data.blockedCategoryList);
      categories.forEach(cat => {
        // Check if already in allowed list (by id or name)
        const isAlreadyAllowed = currentAllowed.some(c =>
          (cat.id && c.id === cat.id) || c.name === cat.name
        );
        if (!isAlreadyAllowed) {
          const option = document.createElement('option');
          option.value = JSON.stringify(cat); // Store full object
          option.textContent = cat.name;
          allowDropdown.appendChild(option);
        }
      });
      // Reset to default option
      allowDropdown.selectedIndex = 0;
    });
  };

  // Handle dropdown selection
  allowDropdown.addEventListener('change', () => {
    const selectedValue = allowDropdown.value;
    if (selectedValue) {
      const selected = parseCategoryOptionValue(selectedValue);
      if (!selected) return;

      const isAlreadyAllowed = currentAllowed.some(c =>
        (selected.id && c.id === selected.id) || c.name === selected.name
      );
      if (!isAlreadyAllowed) {
        currentAllowed.push(selected);
        channel.allowedCategoryList = currentAllowed;
        saveChannelToList(channel);
        renderAllowTags();
        updateDropdownOptions();
      }
    }
  });

  // Initial render
  renderAllowTags();
  updateDropdownOptions();

  // Listen for global settings changes to update dropdown and UI state
  const storageChangeListener = (changes, areaName) => {
    if (areaName === 'local') {
      if (changes.blockedCategoryList) {
        updateDropdownOptions();
      }
      if (changes.allowedOnlyCategoryList) {
        updateChannelCategoryUIState();
      }
    }
  };
  chrome.storage.onChanged.addListener(storageChangeListener);

  allowContentDiv.appendChild(allowTagList);
  allowContentDiv.appendChild(allowDropdown);
  allowContainer.appendChild(allowContentDiv);
  // allowContainer will be appended later in correct order

  // --- Allowed-Only Categories Settings (individual) ---
  const allowedOnlyContainer = document.createElement('div');
  allowedOnlyContainer.className = 'mb-1';

  const allowedOnlyLabelDiv = document.createElement('div');
  allowedOnlyLabelDiv.className = 'd-flex justify-content-between align-items-center mb-1';

  const allowedOnlyLabel = document.createElement('span');
  allowedOnlyLabel.className = 'small';
  allowedOnlyLabel.textContent = chrome.i18n.getMessage('allowedOnlyCategories');

  const allowedOnlyHelpIcon = document.createElement('i');
  allowedOnlyHelpIcon.className = 'bi bi-question-circle-fill text-muted';
  allowedOnlyHelpIcon.style.cursor = 'help';
  allowedOnlyHelpIcon.setAttribute('data-bs-toggle', 'tooltip');
  allowedOnlyHelpIcon.setAttribute('data-bs-title', chrome.i18n.getMessage('allowedOnlyCategoriesHelp'));
  new bootstrap.Tooltip(allowedOnlyHelpIcon, { trigger: 'hover click' });

  allowedOnlyLabelDiv.appendChild(allowedOnlyLabel);
  allowedOnlyLabelDiv.appendChild(allowedOnlyHelpIcon);
  allowedOnlyContainer.appendChild(allowedOnlyLabelDiv);

  const allowedOnlyContentDiv = document.createElement('div');
  allowedOnlyContentDiv.className = 'ps-3';

  // Tag list container
  const allowedOnlyTagList = document.createElement('div');
  allowedOnlyTagList.className = 'd-flex flex-wrap gap-1 mb-1';

  // Current allowed-only categories (array of {id, name})
  let currentAllowedOnly = normalizeCategoryList(channel.allowedOnlyCategoryList);
  if (currentAllowedOnly.length > 0 && Array.isArray(channel.allowedOnlyCategoryList) && typeof channel.allowedOnlyCategoryList[0] === 'string') {
    channel.allowedOnlyCategoryList = currentAllowedOnly;
    saveChannelToList(channel);
  }

  // Function to render the tag list
  const renderAllowedOnlyTags = () => {
    renderCategoryTags({
      container: allowedOnlyTagList,
      categories: currentAllowedOnly,
      badgeClass: 'bg-primary',
      onDelete: (cat) => {
        currentAllowedOnly = currentAllowedOnly.filter(c => c.id !== cat.id || c.name !== cat.name);
        channel.allowedOnlyCategoryList = currentAllowedOnly;
        saveChannelToList(channel);
        renderAllowedOnlyTags();
        channelAllowedOnlySearch?.updateExistingCategories(currentAllowedOnly);
        updateChannelCategoryUIState();
      }
    });
  };

  // Create category search for this channel
  const channelAllowedOnlySearch = createCategorySearchInput({
    onSelect: (category) => {
      // category is {id, name} object
      if (!includesCategory(currentAllowedOnly, category)) {
        currentAllowedOnly.push(category);
        channel.allowedOnlyCategoryList = currentAllowedOnly;
        saveChannelToList(channel);
        renderAllowedOnlyTags();
        channelAllowedOnlySearch.updateExistingCategories(currentAllowedOnly);
        updateChannelCategoryUIState();
      }
    },
    placeholder: chrome.i18n.getMessage('categorySearchPlaceholder'),
    existingCategories: [...currentAllowedOnly],
  });

  allowedOnlyContentDiv.appendChild(allowedOnlyTagList);
  allowedOnlyContentDiv.appendChild(channelAllowedOnlySearch);
  allowedOnlyContainer.appendChild(allowedOnlyContentDiv);

  // --- Blocked Categories Settings ---
  const catContainer = document.createElement('div');
  catContainer.className = 'mb-1';

  const catLabelDiv = document.createElement('div');
  catLabelDiv.className = 'd-flex justify-content-between align-items-center mb-1';

  const catLabel = document.createElement('span');
  catLabel.className = 'small';
  catLabel.textContent = chrome.i18n.getMessage('blockedCategories');

  const catHelpIcon = document.createElement('i');
  catHelpIcon.className = 'bi bi-question-circle-fill text-muted';
  catHelpIcon.style.cursor = 'help';
  catHelpIcon.setAttribute('data-bs-toggle', 'tooltip');
  catHelpIcon.setAttribute('data-bs-title', chrome.i18n.getMessage('blockedCategoriesChannelHelp'));
  new bootstrap.Tooltip(catHelpIcon, { trigger: 'hover click' });

  catLabelDiv.appendChild(catLabel);
  catLabelDiv.appendChild(catHelpIcon);
  catContainer.appendChild(catLabelDiv);

  const catContentDiv = document.createElement('div');
  catContentDiv.className = 'ps-3';

  // Migrate old formats to {id, name} array if needed
  let channelBlockedCategories = normalizeCategoryList(channel.blockedCategoryList);
  // Check if it's in old string array or comma-separated format
  if (channelBlockedCategories.length > 0 && Array.isArray(channel.blockedCategoryList) && typeof channel.blockedCategoryList[0] === 'string') {
    // Persist migrated string array
    channel.blockedCategoryList = channelBlockedCategories;
    saveChannelToList(channel);
  } else if (channelBlockedCategories.length === 0 && channel.blockedCategories) {
    // Migrate from old comma-separated format
    channelBlockedCategories = channel.blockedCategories
      .replace(/\\,/g, '__M_COMMA__')
      .split(',')
      .map(c => c.replace(/__M_COMMA__/g, ',').trim())
      .filter(c => c)
      .map(name => ({ id: null, name }));
    channel.blockedCategoryList = channelBlockedCategories;
    saveChannelToList(channel);
  }

  // Tag list for channel-specific blocked categories
  const catTagList = document.createElement('div');
  catTagList.className = 'd-flex flex-wrap gap-1 mb-1';

  const catAlert = document.createElement('div');
  catAlert.className = 'alert alert-warning py-1 px-2 mt-1 small d-none';
  catAlert.role = 'alert';

  const checkCatOverlap = () => {
    chrome.storage.local.get('blockedCategoryList', (data) => {
      const globalBlocked = normalizeCategoryList(data.blockedCategoryList);
      if (globalBlocked.length === 0) {
        catAlert.classList.add('d-none');
        return;
      }
      const overlap = channelBlockedCategories.filter(local => includesCategory(globalBlocked, local));
      if (overlap.length > 0) {
        catAlert.textContent = chrome.i18n.getMessage('categoryOverlapWarning', [overlap.map(c => c.name).join(', ')]);
        catAlert.classList.remove('d-none');
      } else {
        catAlert.classList.add('d-none');
      }
    });
  };

  // Function to render the blocked tags
  const renderCatTags = () => {
    renderCategoryTags({
      container: catTagList,
      categories: channelBlockedCategories,
      badgeClass: 'bg-danger',
      onDelete: (cat) => {
        channelBlockedCategories = channelBlockedCategories.filter(c => c.id !== cat.id || c.name !== cat.name);
        channel.blockedCategoryList = channelBlockedCategories;
        saveChannelToList(channel);
        renderCatTags();
        channelCatSearch?.updateExistingCategories(channelBlockedCategories);
        checkCatOverlap();
      }
    });
  };

  // Create category search for this channel
  const channelCatSearch = createCategorySearchInput({
    onSelect: (category) => {
      // category is {id, name} object
      if (!includesCategory(channelBlockedCategories, category)) {
        channelBlockedCategories.push(category);
        channel.blockedCategoryList = channelBlockedCategories;
        saveChannelToList(channel);
        renderCatTags();
        channelCatSearch.updateExistingCategories(channelBlockedCategories);
        checkCatOverlap();
      }
    },
    placeholder: chrome.i18n.getMessage('categorySearchPlaceholder'),
    existingCategories: [...channelBlockedCategories],
  });

  catContentDiv.appendChild(catTagList);
  catContentDiv.appendChild(channelCatSearch);
  catContentDiv.appendChild(catAlert);
  catContainer.appendChild(catContentDiv);

  // Separators for layout
  const allowedOnlySeparator = document.createElement('hr');
  allowedOnlySeparator.className = 'my-2';
  const catSeparator = document.createElement('hr');
  catSeparator.className = 'my-2';

  // Append all containers in correct order:
  // 1. 通知 (notifyContainer)
  // 2. このカテゴリだけを開く (allowedOnlyContainer)
  // 3. このカテゴリを除外 (catContainer)
  // 4. 除外の例外 (allowContainer)
  settingsTd.appendChild(notifyContainer);
  settingsTd.appendChild(notifySeparator);
  settingsTd.appendChild(allowedOnlyContainer);
  settingsTd.appendChild(allowedOnlySeparator);
  settingsTd.appendChild(catContainer);
  settingsTd.appendChild(catSeparator);
  settingsTd.appendChild(allowContainer);

  // Function to update UI state based on allowed-only categories
  const updateChannelCategoryUIState = () => {
    chrome.storage.local.get('allowedOnlyCategoryList', (data) => {
      const globalAllowedOnly = normalizeCategoryList(data.allowedOnlyCategoryList);
      const hasChannelAllowedOnly = currentAllowedOnly.length > 0;
      const hasGlobalAllowedOnly = globalAllowedOnly.length > 0;
      const hasAllowedOnly = hasChannelAllowedOnly || hasGlobalAllowedOnly;

      // グレーアウト: 全体除外の例外
      allowTagList.style.opacity = hasAllowedOnly ? '0.5' : '1';
      allowDropdown.style.opacity = hasAllowedOnly ? '0.5' : '1';
      allowDropdown.disabled = hasAllowedOnly;

      // グレーアウト: このカテゴリを除外
      catTagList.style.opacity = hasAllowedOnly ? '0.5' : '1';
      catContentDiv.querySelector('input')?.setAttribute('disabled', hasAllowedOnly);
      if (hasAllowedOnly && channelCatSearch) {
        const input = catContentDiv.querySelector('input');
        if (input) input.disabled = true;
      } else if (channelCatSearch) {
        const input = catContentDiv.querySelector('input');
        if (input) input.disabled = false;
      }
    });
  };

  // Initial renders
  renderAllowedOnlyTags();
  renderCatTags();
  checkCatOverlap();
  updateChannelCategoryUIState();

  // Register cleanup for this channel row
  cleanupFn = () => {
    chrome.storage.onChanged.removeListener(storageChangeListener);
    channelCatSearch?.cleanup?.();
    channelAllowedOnlySearch?.cleanup?.();
  };
  channelCleanups.push(cleanupFn);

  settingsTr.appendChild(settingsTd);

  channelTable.appendChild(settingsTr);
}

function removeChannel(channel) {
  chrome.storage.local.get('channels', (data) => {
    const newChannels = normalizeStoredChannels(data.channels).filter((c) => c?.name !== channel.name);
    chrome.storage.local.set({ channels: newChannels });
  });
}

const CHANNEL_NAME_REGEX = /^[a-z0-9_]{3,25}$/i;

channelInput.addEventListener('input', () => {
  channelInput.classList.remove('is-invalid');
});

addChannelBtn.addEventListener('click', async () => {
  const channel = {
    name: channelInput.value.trim(),
    categoriesFilter: '',
    tagsFilter: '',
    onLiveOpen: true,
  };

  if (!channel.name) return;
  if (!CHANNEL_NAME_REGEX.test(channel.name)) {
    channelInput.classList.add('is-invalid');
    return;
  }
  channelInput.classList.remove('is-invalid');
  if (await duplicatedChannel(channel)) return;

  await checkStream(channel);

  // Add the new channel to the list
  addChannelToList(channel, true);

  // Save the new channel to storage
  saveChannelToList(channel);

  // Clear the input field
  channelInput.value = '';
});

async function duplicatedChannel(channel) {
  const data = await chrome.storage.local.get('channels');
  return (normalizeStoredChannels(data.channels).findIndex((c) => isSameChannel(c, channel)) !== -1);
}

function saveChannelToList(channel) {
  chrome.storage.local.get('channels', (data) => {
    const storedChannels = normalizeStoredChannels(data.channels);
    if (storedChannels.length === 0) {
      const newChannels = [channel];
      chrome.storage.local.set({ channels: newChannels });
    } else {
      const index = storedChannels.findIndex((c) => isSameChannel(c, channel));

      if (index !== -1) {
        storedChannels.splice(index, 1);
      }

      // nullを削除
      const filteredChannels = storedChannels.filter(c => c !== null);
      const newChannels = [...filteredChannels, channel];
      chrome.storage.local.set({ channels: newChannels });
    }
  });
}

enableSwitch.addEventListener('change', () => {
  chrome.storage.local.set({ isEnabled: enableSwitch.checked });
});

enableTabRotation.addEventListener('change', () => {
  chrome.storage.local.set({ isEnabledTabRotation: enableTabRotation.checked });
});

enableMaxTabs.addEventListener('change', () => {
  chrome.storage.local.set({ isEnabledMaxTabs: enableMaxTabs.checked });
});

maxTabCount.addEventListener('change', () => {
  const value = Math.max(1, Math.min(20, parseInt(maxTabCount.value, 10) || 5));
  maxTabCount.value = value;
  chrome.storage.local.set({ maxTabCount: value });
});

enableTabMute.addEventListener('change', () => {
  chrome.storage.local.set({ isEnabledTabMute: enableTabMute.checked });
});

tabRotationInterval.addEventListener('change', () => {
  // 最小値を1分に制限
  const value = Math.max(1, parseInt(tabRotationInterval.value, 10) || 1);
  tabRotationInterval.value = value;
  chrome.storage.local.set({ tabRotationInterval: value });
});

checkInterval.addEventListener('change', () => {
  // 最小値を1分、最大値を60分に制限
  const value = Math.max(1, Math.min(60, parseInt(checkInterval.value, 10) || 1));
  checkInterval.value = value;
  chrome.storage.local.set({ checkInterval: value });
});

enableAutoClose.addEventListener('change', () => {
  chrome.storage.local.set({ isEnabledAutoClose: enableAutoClose.checked });
});

autoOpenOnce.addEventListener('change', () => {
  chrome.storage.local.set({ isAutoOpenOnce: autoOpenOnce.checked });
});

skipBrandedContent.addEventListener('change', () => {
  chrome.storage.local.set({ isSkipBrandedContent: skipBrandedContent.checked });
});

dynamicRotation.addEventListener('change', () => {
  chrome.storage.local.set({ isDynamicRotation: dynamicRotation.checked });
});


liveFilterSwitch.addEventListener('change', async () => {
  await chrome.storage.local.set({ isLiveFilter: liveFilterSwitch.checked });
  refreshList();
});

openNewWindow.addEventListener('change', () => {
  chrome.storage.local.set({ isOpenNewWindow: openNewWindow.checked });
});

if (enableNotifications) {
  enableNotifications.addEventListener('change', () => {
    chrome.storage.local.set({ isEnabledNotifications: enableNotifications.checked });
  });
}

if (aboutBtn) {
  aboutBtn.addEventListener('click', () => {
    const aboutModal = new bootstrap.Modal(document.getElementById('aboutModal'));
    aboutModal.show();
  });
}

async function refreshList() {
  // Clean up all channel listeners before removing DOM
  channelCleanups.forEach(fn => fn());
  channelCleanups.length = 0;

  const channelRows = document.getElementsByClassName('channel-tr');
  while (channelRows.length > 0) {
    channelRows[0].remove();
  }
  const settingsRows = document.getElementsByClassName('settings-tr');
  while (settingsRows.length > 0) {
    settingsRows[0].remove();
  }

  const data = await chrome.storage.local.get('channels');
  updateList(normalizeStoredChannels(data.channels));
}


loginTwitch.addEventListener('click', () => {
  const state = crypto.randomUUID();
  chrome.identity.launchWebAuthFlow({
    url: 'https://id.twitch.tv/oauth2/authorize?' +
      `client_id=${clientId}&` +
      `redirect_uri=${chrome.identity.getRedirectURL()}&` +
      'response_type=token&' +
      'scope=user:read:email&' +
      `state=${state}`,
    interactive: true
  }, responseUrl => {
    handleTwitchAuthResponse(responseUrl, state);
  });
});

function handleTwitchAuthResponse(responseUrl, state) {
  if (!responseUrl) {
    console.error('Invalid OAuth response');
    rewriteNeedsLoginButton(false);
    return;
  }

  let result;
  try {
    const callbackUrl = new URL(responseUrl);
    const fragmentParams = parseHashToObj(callbackUrl.hash);
    result = {
      ...Object.fromEntries(callbackUrl.searchParams),
      ...fragmentParams,
      access_token: fragmentParams.access_token,
    };
  } catch {
    console.error('Invalid OAuth response');
    rewriteNeedsLoginButton(false);
    return;
  }

  if (result.state !== state) {
    console.error('OAuth state mismatch: possible CSRF attack');
    rewriteNeedsLoginButton(false);
    return;
  }

  const oauth_token = result.access_token;
  if (!isValidOAuthAccessToken(oauth_token)) {
    console.error('OAuth response missing access token');
    rewriteNeedsLoginButton(false);
    return;
  }

  chrome.storage.local.set({ oauth_token });
  checkTwitchConnection(oauth_token);
}

function parseHashToObj(hash) {
  return Object.fromEntries(new URLSearchParams(hash.replace('#', '')));
}

function isValidOAuthAccessToken(accessToken) {
  return typeof accessToken === 'string' && accessToken.trim() !== '';
}

function checkTwitchConnection(oauthToken) {
  const token = oauthToken;
  return fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { 'Authorization': 'OAuth ' + token },
  })
    .then(response => {
      rewriteNeedsLoginButton(response.ok);
      return response.ok;
    })
    .catch(error => {
      console.error(error);
      rewriteNeedsLoginButton(false);
      return false;
    });
}

function rewriteNeedsLoginButton(isOk) {
  const mainElements = document.getElementById('main');
  if (isOk) {
    loginTwitch.textContent = 'Connected';
  } else {
    loginTwitch.textContent = 'Please login to Twitch';
  }
  loginTwitch.disabled = isOk;
  mainElements.hidden = !isOk;
}

async function checkStream(channel) {
  if (!channel) return;

  const oauth_token = migrateOAuthToken((await chrome.storage.local.get('oauth_token')).oauth_token);

  const url = `https://api.twitch.tv/helix/streams?user_login=${channel.name}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  const options = {
    headers: {
      'Client-ID': clientId,
      'Authorization': 'Bearer ' + oauth_token,
    },
    signal: controller.signal,
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      channel.status = 'error';
      return channel;
    }

    const data = await response.json();

    if (data.data === undefined) {
      channel.status = 'error';
      return channel;
    }

    if (data.data.length > 0) {
      console.log('online', data.data[0]);
      const stream = data.data[0];
      channel.onLive = true;
      channel.game_name = stream.game_name;
      channel.tags = stream.tags;
      channel.title = stream.title;
      channel.viewer_count = stream.viewer_count;
      channel.status = 'online';
    } else {
      console.log('offline', channel.name);
      channel.onLive = false;
      channel.status = 'offline';
    }

    return channel;
  } catch (error) {
    console.error('checkStream error:', error);
    channel.status = 'error';
    return channel;
  } finally {
    clearTimeout(timeoutId);
  }
}



// Miteruyoの管理対象ウィンドウでタブを開く（background.jsへ委譲）
async function openInManagedWindow(channelName) {
  return chrome.runtime.sendMessage({ action: 'openInManagedWindow', channelName });
}
