const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const SCREENSHOT_DIR = path.join(__dirname, '../screenshots');

async function takeScreenshot(options = {}) {
  const { openSettings = true, openChannelSettings = false } = options;

  // Create screenshots directory if not exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
    ],
  });

  try {
    // Wait for extension to load
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get the extension ID
    const targets = await browser.targets();
    const extensionTarget = targets.find(
      target => target.type() === 'service_worker' && target.url().includes('chrome-extension://')
    );

    if (!extensionTarget) {
      throw new Error('Extension not found');
    }

    const extensionUrl = extensionTarget.url();
    const extensionId = extensionUrl.split('/')[2];
    console.log('Extension ID:', extensionId);

    // Open popup page directly
    const page = await browser.newPage();
    await page.setViewport({ width: 330, height: 900 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'networkidle0',
    });

    // Force show main UI and hide login button
    await page.evaluate(() => {
      // Show main content
      const main = document.getElementById('main');
      if (main) main.hidden = false;

      // Hide login button
      const loginBtn = document.getElementById('loginTwitch');
      if (loginBtn) loginBtn.style.display = 'none';
    });

    // Add test data to storage
    await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.local.set({
          oauth_token: { oauth_token: 'dummy_token_for_testing' },
          isEnabled: true,
          channels: [
            {
              name: 'test_channel',
              onLive: true,
              status: 'Test Stream Title',
              game_name: 'Just Chatting',
              game_id: '509658',
              enableCustomVolume: false,
              volume: 100,
              notificationSetting: 'global',
              allowedOnlyCategoryList: [],
              blockedCategoryList: [
                { id: '12345', name: 'Slots' }
              ]
            }
          ],
          blockedCategoryList: [
            { id: '509658', name: 'Just Chatting' },
            { id: '26936', name: 'Music' }
          ],
          allowedOnlyCategoryList: [
            { id: '33214', name: 'Fortnite' }
          ]
        }, resolve);
      });
    });

    // Manually render a test channel for UI testing
    await page.evaluate((showChannelSettings) => {
      const channelTableBody = document.getElementById('channelTableBody');
      if (!channelTableBody) return;

      // Create mock channel rows using the same layout classes as popup.js.
      const rows = [
        { channelName: 'icarus0219', statusLabel: chrome.i18n.getMessage('statusLive') || 'LIVE', statusClass: 'success', showToggle: true, showSettings: true },
        { channelName: 'snoozed_user', statusLabel: chrome.i18n.getMessage('snoozed') || 'Snoozed', statusClass: 'warning', showToggle: true, showSettings: true },
        { channelName: 'byodoji', statusLabel: chrome.i18n.getMessage('statusOffline') || 'OFFLINE', statusClass: 'danger', showToggle: true, showSettings: true },
        { channelName: 'missing_channel', statusLabel: chrome.i18n.getMessage('statusNotFound') || 'NOT FOUND', statusClass: 'danger', showToggle: false, showSettings: false },
      ];
      for (const row of rows) {
        const tr = document.createElement('tr');
        tr.className = 'align-middle channel-tr';
        tr.innerHTML = `
          <td>
            <div class="channel-controls">
              <button class="btn btn-outline-${row.statusClass} btn-sm channel-status-btn" type="button">${row.statusLabel}</button>
              ${row.showToggle ? `<button class="btn btn-outline-secondary btn-sm channel-icon-btn" type="button">
                <i class="bi bi-play-fill"></i>
              </button>` : ''}
            </div>
          </td>
          <td class="channel-name-cell">
            <span title="${row.channelName}">${row.channelName}</span>
          </td>
          <td class="text-end">
            <div class="channel-row-actions" role="group" aria-label="Channel actions">
              ${row.showSettings ? `<button class="channel-row-action" type="button" aria-label="Settings">
                <i class="bi bi-gear"></i>
              </button>` : ''}
              <button class="channel-row-action text-danger" type="button" aria-label="Delete">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        `;
        channelTableBody.appendChild(tr);
      }

      // Create settings row (expanded)
      const settingsTr = document.createElement('tr');
      const settingsTd = document.createElement('td');
      settingsTd.colSpan = 3;
      settingsTd.className = 'bg-light p-2';
      settingsTd.innerHTML = `
        <div class="mb-1">
          <span class="small">このカテゴリだけを開く</span><i class="bi bi-question-circle-fill text-muted ms-1" style="cursor: help;"></i>
          <div class="ps-3">
            <div class="d-flex flex-wrap gap-1 mb-1 mt-1"></div>
            <input type="text" class="form-control form-control-sm" placeholder="カテゴリを検索して追加...">
          </div>
        </div>
        <hr class="my-2">
        <div class="mb-1">
          <span class="small">このカテゴリを除外</span><i class="bi bi-question-circle-fill text-muted ms-1" style="cursor: help;"></i>
          <div class="ps-3">
            <div class="d-flex flex-wrap gap-1 mb-1 mt-1">
              <span class="badge bg-secondary d-flex align-items-center">Slots <button class="btn-close btn-close-white ms-1" style="font-size: 0.6rem;"></button></span>
            </div>
            <input type="text" class="form-control form-control-sm" placeholder="カテゴリを検索して追加...">
          </div>
        </div>
        <hr class="my-2">
        <div class="mb-1">
          <span class="small">全体除外の例外</span><i class="bi bi-question-circle-fill text-muted ms-1" style="cursor: help;"></i>
          <div class="ps-3">
            <select class="form-select form-select-sm">
              <option value="">追加...</option>
            </select>
          </div>
        </div>
      `;
      settingsTr.appendChild(settingsTd);

      if (showChannelSettings) {
        channelTableBody.appendChild(settingsTr);
      }
    }, openChannelSettings);

    // Wait for content to render
    await new Promise(resolve => setTimeout(resolve, 300));

    // Open settings accordion if requested
    if (openSettings) {
      await page.evaluate(() => {
        const accordion = document.querySelector('.accordion-button');
        if (accordion) {
          accordion.classList.remove('collapsed');
          const collapse = document.getElementById('collapseConfig');
          if (collapse) {
            collapse.classList.add('show');
          }
        }
      });
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    const layoutMetrics = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    if (layoutMetrics.scrollWidth > layoutMetrics.clientWidth) {
      throw new Error(`Popup layout overflow: scrollWidth=${layoutMetrics.scrollWidth}, clientWidth=${layoutMetrics.clientWidth}`);
    }

    const clippedStatusLabels = await page.evaluate(() => (
      Array.from(document.querySelectorAll('.channel-status-btn'))
        .filter(button => button.scrollWidth > button.clientWidth || button.scrollHeight > button.clientHeight)
        .map(button => ({
          label: button.textContent.trim(),
          clientWidth: button.clientWidth,
          scrollWidth: button.scrollWidth,
        }))
    ));
    if (clippedStatusLabels.length > 0) {
      throw new Error(`Popup status labels clipped: ${JSON.stringify(clippedStatusLabels)}`);
    }

    const statusWidths = await page.evaluate(() => (
      Array.from(document.querySelectorAll('.channel-status-btn'))
        .map(button => ({
          label: button.textContent.trim(),
          width: Math.round(button.getBoundingClientRect().width),
        }))
    ));
    const distinctStatusWidths = new Set(statusWidths.map(button => button.width));
    if (distinctStatusWidths.size > 1) {
      throw new Error(`Popup status button widths differ: ${JSON.stringify(statusWidths)}`);
    }

    const clippedSwitchLabels = await page.evaluate(() => (
      Array.from(document.querySelectorAll('.popup-switch .form-check-label'))
        .filter(label => label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight)
        .map(label => ({
          label: label.textContent.trim(),
          clientWidth: label.clientWidth,
          scrollWidth: label.scrollWidth,
        }))
    ));
    if (clippedSwitchLabels.length > 0) {
      throw new Error(`Popup switch labels clipped: ${JSON.stringify(clippedSwitchLabels)}`);
    }

    const viewportOverflow = await page.evaluate(() => (
      Array.from(document.querySelectorAll('.popup-switch, .channel-controls, .channel-row-actions'))
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5;
        })
        .map(element => ({
          className: element.className,
          left: element.getBoundingClientRect().left,
          right: element.getBoundingClientRect().right,
          clientWidth: document.documentElement.clientWidth,
        }))
    ));
    if (viewportOverflow.length > 0) {
      throw new Error(`Popup controls overflow viewport: ${JSON.stringify(viewportOverflow)}`);
    }

    // Take screenshot
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(SCREENSHOT_DIR, `popup-${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('Screenshot saved:', screenshotPath);

    // Also save as latest.png for easy access
    const latestPath = path.join(SCREENSHOT_DIR, 'latest.png');
    await page.screenshot({ path: latestPath, fullPage: true });
    console.log('Latest screenshot:', latestPath);

    return latestPath;
  } finally {
    await browser.close();
  }
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const openChannelSettings = args.includes('--channel');

  takeScreenshot({ openChannelSettings })
    .then(path => {
      console.log('Done!');
      process.exit(0);
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

module.exports = { takeScreenshot };
