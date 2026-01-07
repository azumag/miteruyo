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
    await page.setViewport({ width: 400, height: 900 });
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

      // Create mock channel row
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.innerHTML = '<span class="badge bg-success me-1">LIVE</span><a href="#" class="small">test_channel</a>';
      tr.appendChild(nameTd);

      const statusTd = document.createElement('td');
      statusTd.innerHTML = '<small class="text-muted">Just Chatting</small>';
      tr.appendChild(statusTd);

      const btnTd = document.createElement('td');
      btnTd.innerHTML = '<button class="btn btn-outline-secondary btn-sm">...</button>';
      tr.appendChild(btnTd);

      channelTableBody.appendChild(tr);

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
