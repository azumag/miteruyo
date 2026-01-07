const loading = document.getElementById('loading');
const channelInput = document.getElementById('channelInput');
const addChannelBtn = document.getElementById('addChannelBtn');
const channelTable = document.getElementById('channelTableBody');
const enableSwitch = document.getElementById('enableSwitch');
const openNewWindow = document.getElementById('openNewWindow');
const enableTabRotation = document.getElementById('enableTabRotation');
const enableTabMute = document.getElementById('enableTabMute');
const enableAutoClose = document.getElementById('enableAutoClose');
const tabRotationInterval = document.getElementById('tabRotationInterval');
const skipBrandedContent = document.getElementById('skipBrandedContent');
const blockedCategoriesInput = document.getElementById('blockedCategories');

const loginTwitch = document.getElementById('loginTwitch');

const liveFilterSwitch = document.getElementById('liveFilterSwitch');

const twitchDomain = 'https://www.twitch.tv';
// const clientId = 'vzlsgu6bdv9tbad1uroc9v8tz813cx'; // for prod
const clientId = 'lt060jwpltwp3weqdk53dx450aj99p';

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

  // 新しいウィンドウで開く
  const openNewWindowMessage = chrome.i18n.getMessage('openNewWindow');
  document.querySelector('label[for="openNewWindow"]').textContent = openNewWindowMessage;
  // 複数タブ自動切り替え
  const enableTabRotationMessage = chrome.i18n.getMessage('enableTabRotation');
  document.querySelector('label[for="enableTabRotation"]').textContent = enableTabRotationMessage;
  // 分
  const minutesMessage = chrome.i18n.getMessage('minutes');
  document.getElementById('rotationUnit').textContent = minutesMessage;
  // 非アクティブタブ自動ミュート
  const enableTabMuteMessage = chrome.i18n.getMessage('enableTabMute');
  document.querySelector('label[for="enableTabMute"]').textContent = enableTabMuteMessage;
  // オフラインチャネル自動閉じ
  const enableAutoCloseMessage = chrome.i18n.getMessage('enableAutoClose');
  document.querySelector('label[for="enableAutoClose"]').textContent = enableAutoCloseMessage;
  // プロモーション配信を開かない
  const skipBrandedContentMessage = chrome.i18n.getMessage('skipBrandedContent');
  document.querySelector('label[for="skipBrandedContent"]').textContent = skipBrandedContentMessage;
  // 開かないカテゴリ
  const blockedCategoriesMessage = chrome.i18n.getMessage('blockedCategories');
  document.querySelector('label[for="blockedCategories"]').textContent = blockedCategoriesMessage;
  // カテゴリ別音量
  // const categoryVolumesMessage = chrome.i18n.getMessage('categoryVolumes');
  // document.querySelector('label[for="categoryVolumes"]').textContent = categoryVolumesMessage;
});

chrome.storage.local.get(
  {
    channels: [],
    isEnabled: false,
    isOpenNewWindow: false,
    isOpenMultiTwitch: false,
    isLiveFilter: false,
    oauth_token: null,
    tabRotationInterval: 5,
    isEnabledTabRotation: false,
    isEnabledTabMute: false,
    isEnabledAutoClose: false,
    isSkipBrandedContent: false,
    blockedCategoryNames: '',
  },
  async (data) => {
    loading.hidden = false;

    enableSwitch.checked = data.isEnabled;
    openNewWindow.checked = data.isOpenNewWindow;
    liveFilterSwitch.checked = data.isLiveFilter;
    tabRotationInterval.value = data.tabRotationInterval;
    enableTabMute.checked = data.isEnabledTabMute;
    enableTabRotation.checked = data.isEnabledTabRotation;
    enableAutoClose.checked = data.isEnabledAutoClose;
    skipBrandedContent.checked = data.isSkipBrandedContent;
    blockedCategoriesInput.value = data.blockedCategoryNames;

    if (data.oauth_token) {
      const connected = await checkTwitchConnection(data.oauth_token);
      if (connected) updateList(data.channels);
    } else {
      rewriteNeedsLoginButton(false);
    }

    loading.hidden = true;
  }
);

async function updateList(dchannels) {
  const checkStreams = [];
  for (const _channel of dchannels) {
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
  Promise.all(checkStreams).then((channels) => {
    chrome.storage.local.set({ channels });
  });
}

async function addChannelToList(channel, newAdded = false) {
  if (!newAdded && channel.status !== 'error' && liveFilterSwitch.checked && !channel.onLive) return;

  const pauseMsg = chrome.i18n.getMessage('pause');

  const tr = document.createElement('tr');
  tr.className = 'align-middle'; // Ensure vertical centering
  tr.classList.add('channel-tr');

  // 1. Live Status & On/Off Switch
  const statusTd = document.createElement('td');
  statusTd.classList.add('pe-0'); // Remove right padding
  const statusContainer = document.createElement('div');
  statusContainer.className = 'd-flex align-items-center gap-1';
  statusTd.appendChild(statusContainer);
  tr.appendChild(statusTd);

  const openButton = document.createElement('button');
  statusContainer.appendChild(openButton);

  if (channel.onLive) {
    openButton.textContent = channel.onLiveOpen ? 'LIVE' : 'Pause';
    openButton.setAttribute('class', 'btn btn-outline-success btn-sm min-width-');
    openButton.style.width = '60px';
    openButton.addEventListener('click', () => {
      openInManagedWindow(channel.name);
    });
  } else {
    openButton.textContent = channel.onLiveOpen ? 'OFFLINE' : pauseMsg;
    openButton.setAttribute('class', 'btn btn-outline-danger btn-sm');
  }

  if (channel.status === 'error') {
    openButton.textContent = 'NOT FOUND';
    openButton.setAttribute('class', 'btn btn-outline-danger btn-sm');
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

    if (channel.onLive) {
      openButton.textContent = channel.onLiveOpen ? 'LIVE' : pauseMsg;
      openButton.setAttribute('class', 'btn btn-outline-success btn-sm');
      openButton.style.width = '60px';
      openButton.addEventListener('click', () => {
        openInManagedWindow(channel.name);
      });
    } else {
      openButton.textContent = channel.onLiveOpen ? 'OFFLINE' : pauseMsg;
      openButton.setAttribute('class', 'btn btn-outline-danger btn-sm');
    }
  });

  if (channel.status !== 'error') {
    statusContainer.appendChild(onLiveOpenSwitch);
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
    // Remove settings row if exists
    const nextRow = tr.nextSibling;
    if (nextRow && nextRow.classList.contains('settings-tr')) {
      nextRow.remove();
    }
    tr.remove();
    removeChannel(channel);
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
  volLabel.textContent = '音量';

  const volRange = document.createElement('input');
  volRange.type = 'range';
  volRange.className = 'form-range me-2 flex-grow-1';
  // Removed fixed width: 100px

  volRange.min = 0;
  volRange.max = 100;
  volRange.value = channel.customVolume !== undefined ? channel.customVolume : 50;

  const volValue = document.createElement('span');
  volValue.className = 'small';
  volValue.textContent = `${volRange.value}%`;

  // Spinner for applying state
  const volSpinner = document.createElement('div');
  volSpinner.className = 'spinner-border spinner-border-sm text-primary me-1';
  volSpinner.style.display = 'none';
  volSpinner.setAttribute('role', 'status');

  const volApplyingText = document.createElement('span');
  volApplyingText.className = 'small text-primary me-2';
  volApplyingText.textContent = '適用中...';
  volApplyingText.style.display = 'none';

  // Apply initial volume state
  toggleState(volCheck.checked, [volRange, volValue]);

  // Append volume UI elements to container
  volContainer.appendChild(volCheck);
  volContainer.appendChild(volLabel);
  volContainer.appendChild(volSpinner);
  volContainer.appendChild(volApplyingText);
  volContainer.appendChild(volRange);
  volContainer.appendChild(volValue);

  settingsTd.appendChild(volContainer);

  // Add separator after volume
  const volSeparator = document.createElement('hr');
  volSeparator.className = 'my-2';
  settingsTd.appendChild(volSeparator);

  // --- Branded Content Settings ---
  const brandedContainer = document.createElement('div');
  brandedContainer.className = 'mb-1';

  const brandedLabel = document.createElement('div');
  brandedLabel.className = 'small mb-1';
  brandedLabel.textContent = 'PR配信';
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

  const { wrapper: openWrapper, input: radioOpenInput } = createBrandedRadio('open', 'open', '開く');
  const { wrapper: blockWrapper, input: radioBlockInput } = createBrandedRadio('block', 'block', '開かない');
  const { wrapper: globalWrapper, input: radioGlobalInput } = createBrandedRadio('global', 'global', '全体設定に従う');

  const brandedSetting = channel.brandedContentSetting || 'global';
  if (brandedSetting === 'open') radioOpenInput.checked = true;
  else if (brandedSetting === 'block') radioBlockInput.checked = true;
  else radioGlobalInput.checked = true;

  brandedRadioGroup.appendChild(openWrapper);
  brandedRadioGroup.appendChild(blockWrapper);
  brandedRadioGroup.appendChild(globalWrapper);
  brandedContainer.appendChild(brandedRadioGroup);
  settingsTd.appendChild(brandedContainer);

  const saveBrandedSettings = () => {
    if (radioOpenInput.checked) channel.brandedContentSetting = 'open';
    else if (radioBlockInput.checked) channel.brandedContentSetting = 'block';
    else channel.brandedContentSetting = 'global';
    saveChannelToList(channel);
  };
  radioOpenInput.addEventListener('change', saveBrandedSettings);
  radioBlockInput.addEventListener('change', saveBrandedSettings);
  radioGlobalInput.addEventListener('change', saveBrandedSettings);

  // Add separator after PR settings
  const prSeparator = document.createElement('hr');
  prSeparator.className = 'my-2';
  settingsTd.appendChild(prSeparator);

  // --- Allow Categories Settings (override global blocked) ---
  const allowContainer = document.createElement('div');
  allowContainer.className = 'mb-1';

  const allowLabelDiv = document.createElement('div');
  allowLabelDiv.className = 'd-flex align-items-center mb-1';

  const allowLabel = document.createElement('span');
  allowLabel.className = 'small';
  allowLabel.textContent = '開くカテゴリ';

  const allowHelpIcon = document.createElement('i');
  allowHelpIcon.className = 'bi bi-question-circle-fill text-muted ms-1';
  allowHelpIcon.style.cursor = 'help';
  allowHelpIcon.setAttribute('data-bs-toggle', 'tooltip');
  allowHelpIcon.setAttribute('data-bs-title', '全体設定で設定した除外カテゴリのうち、個別に開くカテゴリ');
  new bootstrap.Tooltip(allowHelpIcon, { trigger: 'hover click' });

  allowLabelDiv.appendChild(allowLabel);
  allowLabelDiv.appendChild(allowHelpIcon);
  allowContainer.appendChild(allowLabelDiv);

  const allowSelectDiv = document.createElement('div');
  allowSelectDiv.className = 'ps-3';

  const allowSelect = document.createElement('select');
  allowSelect.className = 'form-select form-select-sm';
  allowSelect.multiple = true;
  allowSelect.id = `allowCats-${channel.name}`;
  allowSelect.style.height = '80px';

  // Populate from global blocked categories
  chrome.storage.local.get('blockedCategoryNames', (data) => {
    const globalBlocked = data.blockedCategoryNames || '';
    if (globalBlocked.trim()) {
      const categories = globalBlocked.replace(/\\,/g, '__M_COMMA__').split(',').map(c => c.replace(/__M_COMMA__/g, ',').trim()).filter(c => c);
      const currentAllowed = channel.allowedCategories || [];
      categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        option.selected = currentAllowed.includes(cat);
        allowSelect.appendChild(option);
      });
    }
  });

  allowSelectDiv.appendChild(allowSelect);
  allowContainer.appendChild(allowSelectDiv);
  settingsTd.appendChild(allowContainer);

  const saveAllowSettings = () => {
    channel.allowedCategories = Array.from(allowSelect.selectedOptions).map(o => o.value);
    saveChannelToList(channel);
  };
  allowSelect.addEventListener('change', saveAllowSettings);

  // Add separator after Allow Categories
  const allowSeparator = document.createElement('hr');
  allowSeparator.className = 'my-2';
  settingsTd.appendChild(allowSeparator);

  // --- Blocked Categories Settings ---
  const catContainer = document.createElement('div');
  catContainer.className = 'mb-1';

  const catLabelDiv = document.createElement('div');
  catLabelDiv.className = 'd-flex align-items-center mb-1';

  const catLabel = document.createElement('span');
  catLabel.className = 'small';
  catLabel.textContent = '開かないカテゴリ';

  const catHelpIcon = document.createElement('i');
  catHelpIcon.className = 'bi bi-question-circle-fill text-muted ms-1';
  catHelpIcon.style.cursor = 'help';
  catHelpIcon.setAttribute('data-bs-toggle', 'tooltip');
  catHelpIcon.setAttribute('data-bs-title', '全体設定に追加する除外カテゴリ');
  new bootstrap.Tooltip(catHelpIcon, { trigger: 'hover click' });

  catLabelDiv.appendChild(catLabel);
  catLabelDiv.appendChild(catHelpIcon);
  catContainer.appendChild(catLabelDiv);

  const catInputDiv = document.createElement('div');
  catInputDiv.className = 'ps-3';

  const catInput = document.createElement('input');
  catInput.type = 'text';
  catInput.id = `blockedCats-${channel.name}`;
  catInput.className = 'form-control form-control-sm';
  catInput.placeholder = 'カテゴリ名 (カンマ区切り)';
  catInput.value = channel.blockedCategories || '';

  const catAlert = document.createElement('div');
  catAlert.className = 'alert alert-warning py-1 px-2 mt-1 small d-none';
  catAlert.role = 'alert';

  catInputDiv.appendChild(catInput);
  catInputDiv.appendChild(catAlert);
  catContainer.appendChild(catInputDiv);
  settingsTd.appendChild(catContainer);

  const checkCatOverlap = () => {
    chrome.storage.local.get('blockedCategoryNames', (data) => {
      const globalBlocked = data.blockedCategoryNames || '';
      if (!globalBlocked.trim()) {
        catAlert.classList.add('d-none');
        return;
      }
      const globalList = globalBlocked.replace(/\\,/g, '__M_COMMA__').split(',').map(c => c.replace(/__M_COMMA__/g, ',').trim().toLowerCase()).filter(c => c);
      const localList = catInput.value.replace(/\\,/g, '__M_COMMA__').split(',').map(c => c.replace(/__M_COMMA__/g, ',').trim().toLowerCase()).filter(c => c);
      const overlap = localList.filter(c => globalList.includes(c));
      if (overlap.length > 0) {
        catAlert.textContent = `以下は全体設定で既に指定されています: ${overlap.join(', ')}`;
        catAlert.classList.remove('d-none');
      } else {
        catAlert.classList.add('d-none');
      }
    });
  };

  const saveCatSettings = () => {
    channel.blockedCategories = catInput.value;
    saveChannelToList(channel);
    checkCatOverlap();
  };
  catInput.addEventListener('change', saveCatSettings);
  catInput.addEventListener('input', checkCatOverlap);
  // Initial check
  checkCatOverlap();

  settingsTr.appendChild(settingsTd);

  channelTable.appendChild(settingsTr);
}

function removeChannel(channel) {
  chrome.storage.local.get('channels', (data) => {
    const newChannels = data.channels.filter((c) => c.name !== channel.name);
    chrome.storage.local.set({ channels: newChannels });
  });
}

addChannelBtn.addEventListener('click', async () => {
  const channel = {
    name: channelInput.value.trim(),
    categoriesFilter: '',
    tagsFilter: '',
    onLiveOpen: true,
  };

  if (!channel.name) return;
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
  return (data.channels.findIndex((c) => c?.name === channel.name) !== -1);
}

function saveChannelToList(channel) {
  chrome.storage.local.get('channels', (data) => {
    if (Object.keys(data).length === 0) {
      const newChannels = [channel];
      chrome.storage.local.set({ channels: newChannels });
    } else {
      const index = data.channels.findIndex((c) => c?.name === channel.name);

      if (index !== -1) {
        data.channels.splice(index, 1);
      }

      // nullを削除
      const filteredChannels = data.channels.filter(c => c !== null);
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

enableTabMute.addEventListener('change', () => {
  chrome.storage.local.set({ isEnabledTabMute: enableTabMute.checked });
});

tabRotationInterval.addEventListener('change', () => {
  // 最小値を1分に制限
  const value = Math.max(1, parseInt(tabRotationInterval.value, 10) || 1);
  tabRotationInterval.value = value;
  chrome.storage.local.set({ tabRotationInterval: value });
});

enableAutoClose.addEventListener('change', () => {
  chrome.storage.local.set({ isEnabledAutoClose: enableAutoClose.checked });
});

skipBrandedContent.addEventListener('change', () => {
  chrome.storage.local.set({ isSkipBrandedContent: skipBrandedContent.checked });
});


blockedCategoriesInput.addEventListener('change', () => {
  chrome.storage.local.set({ blockedCategoryNames: blockedCategoriesInput.value });
});

liveFilterSwitch.addEventListener('change', async () => {
  await chrome.storage.local.set({ isLiveFilter: liveFilterSwitch.checked });
  refreshList();
});

openNewWindow.addEventListener('change', () => {
  chrome.storage.local.set({ isOpenNewWindow: openNewWindow.checked });
});

async function refreshList() {
  const list = document.getElementsByClassName('channel-tr');
  while (list.length > 0) {
    list[0].remove();
  }

  const data = await chrome.storage.local.get('channels');
  updateList(data.channels);
}


loginTwitch.addEventListener('click', () => {
  console.log(chrome.identity.getRedirectURL());
  chrome.identity.launchWebAuthFlow({
    url: 'https://id.twitch.tv/oauth2/authorize?' +
      `client_id=${clientId}&` +
      `redirect_uri=${chrome.identity.getRedirectURL()}&` +
      'response_type=token&' +
      'scope=user:read:email',
    interactive: true
  }, responseUrl => {
    console.log({ responseUrl });
    if (responseUrl) {
      let hash = new URL(responseUrl).hash;
      let result = parseHashToObj(hash);
      let oauth_token = { oauth_token: result.access_token };
      chrome.storage.local.set({ oauth_token });
      checkTwitchConnection(oauth_token);
      console.log(oauth_token);
    } else {
      console.error('Invalid response URL:', responseUrl);
      loginTwitch.text = 'login fail: please login twitch';
      loginTwitch.enable = true;
    }
  });
});

function parseHashToObj(hash) {
  return hash.replace('#', '').split('&').reduce((res, item) => {
    const parts = item.split('=');
    res[parts[0]] = parts[1];
    return res;
  }, {});
}

function checkTwitchConnection(oauthToken) {
  console.log('checkTwitch');
  const token = oauthToken.oauth_token;
  const url = 'https://api.twitch.tv/helix/users?login=azumagbanjo';
  // const url = "https://api.twitch.tv/helix/users?login=azumagdev";
  const headers = {
    'Client-Id': clientId,
    'Authorization': 'Bearer ' + token,
  };
  const options = {
    'method': 'GET',
    'headers': headers,
  };
  return fetch(url, options)
    .then(response => {
      console.log(response);
      rewriteNeedsLoginButton(response.ok);
      return true;
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
    loginTwitch.textContent = 'connected';
  } else {
    loginTwitch.textContent = 'please login twitch';
  }
  loginTwitch.disabled = isOk;
  mainElements.hidden = !isOk;
}

async function checkStream(channel) {
  if (!channel) return;

  const oauth_token = (await chrome.storage.local.get('oauth_token')).oauth_token;

  const url = `https://api.twitch.tv/helix/streams?user_login=${channel.name}`;
  const options = {
    headers: {
      'Client-ID': clientId,
      'Accept': 'application/vnd.twitchtv.v5+json',
      'Authorization': 'Bearer ' + oauth_token.oauth_token,
    },
  };

  const response = await fetch(url, options);
  const data = await response.json();

  if (data.data === undefined) {
    // removeChannel(channel);
    // console.log(data);
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
}

async function saveChannel(channel) {
  const channels = (await chrome.storage.local.get('channels')).channels;
  const index = channels.findIndex((c) => c?.name === channel.name);

  if (index !== -1) {
    channels.splice(index, 1);
  }

  // nullを削除
  const filteredChannels = channels.filter(c => c !== null);
  const newChannels = [...filteredChannels, channel];
  await chrome.storage.local.set({ channels: newChannels });
}

function deleteNullChannel() {
  chrome.storage.local.get('channels', (data) => {
    const newChannels = data.channels.filter(c => c !== null);
    chrome.storage.local.set({ channels: newChannels });
  });
}

function flushAuthToken() {
  chrome.storage.local.set({ oauth_token: null });
}

// Miteruyoの管理対象ウィンドウでタブを開く
async function openInManagedWindow(channelName) {
  const url = twitchDomain + '/' + channelName;
  const data = await chrome.storage.local.get(['isOpenNewWindow', 'lastOpenWindowId']);

  if (data.isOpenNewWindow) {
    // 新しいウィンドウで開く設定の場合
    let windowId = data.lastOpenWindowId;

    // 既存のウィンドウが有効かチェック
    if (windowId) {
      try {
        await chrome.windows.get(windowId);
      } catch {
        windowId = null;
      }
    }

    if (windowId) {
      // 既存の管理対象ウィンドウにタブを追加
      const tab = await chrome.tabs.create({ url, windowId });
      return tab;
    } else {
      // 新しいウィンドウを作成して管理対象に登録
      const newWindow = await chrome.windows.create({ url });
      await chrome.storage.local.set({ lastOpenWindowId: newWindow.id });
      return newWindow.tabs[0];
    }
  } else {
    // 現在のウィンドウで開く
    const tab = await chrome.tabs.create({ url });
    // 開いたタブのウィンドウを管理対象に登録
    await chrome.storage.local.set({ lastOpenWindowId: tab.windowId });
    return tab;
  }
}