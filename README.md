# Miteruyo - Twitch Stream Monitoring Extension

A Chrome extension that monitors Twitch channels and automatically opens streams when they go live.

## Features

- **Real-time Stream Monitoring**: Checks channel status every minute via Twitch Helix API
- **Auto-open Streams**: Automatically opens new tabs when monitored channels go live
- **Tab Management**:
  - Auto-rotate between open streams at configurable intervals
  - Auto-mute inactive tabs
  - Auto-close tabs when streams go offline
- **Multiple Window Support**: Open streams in specific windows or across multiple windows
- **Multi-Twitch Integration**: Support for watching multiple streams simultaneously
- **Desktop Notifications**: Get notified when monitored channels go live
- **Per-channel Volume Control**: Set custom volume for each channel
- **Category Filtering**: Only auto-open streams from specific categories
- **Snooze**: Temporarily suppress auto-open for a channel until the next stream

## Improvements (v1.0.11+)

### Service Worker Reliability
- Robust alarm initialization that survives Service Worker restarts
- Fallback checks on Chrome startup and extension installation
- Persistent polling even if Chrome terminates the Service Worker

### Performance
- Parallel channel checking (all channels checked simultaneously)
- Efficient batch storage updates
- 10-second timeout protection for API calls

### Code Quality
- Automated testing with Vitest
- ESLint code quality checks via GitHub Actions
- Comprehensive error handling and logging

## Installation

### From Source
1. Clone this repository
2. Open `chrome://extensions/`
3. Enable "Developer mode" (top-right)
4. Click "Load unpacked" and select this directory

### Configuration
Configure via the extension popup:
- **Enable/Disable**: Toggle the extension on/off
- **Channels**: Add channels to monitor
- **Auto-open**: Enable auto-opening when streams go live
- **Tab Rotation**: Enable and set rotation interval (1+ minutes)
- **Tab Muting**: Auto-mute inactive tabs
- **Auto-close**: Close tabs when streams go offline (channel pages only)
- **New Window**: Open streams in new windows instead of current window
- **Skip Sponsored**: Don't auto-open sponsored/branded content streams
- **Category Filters**:
  - **Allowed-Only Categories**: Only open streams in these specific categories (overrides all other filters)
  - **Blocked Categories**: Search and select categories to not auto-open (uses Twitch API for category search)
- **Per-channel Settings**:
  - **Allowed-Only Categories**: Only open this channel when streaming specific categories (overrides all other filters)
  - Allow specific categories (override global blocked list)
  - Block additional categories for specific channels
- **Priority System**: Allowed-only > Blocked/Allowed lists. When allowed-only is set, blocked/allowed lists are grayed out

### Context Menu
Right-click on any Twitch channel link to "Open with Miteruyo" - the tab will be managed (rotation, mute, auto-close).

## Development

### Setup
```bash
npm install
```

### Testing
```bash
# Run tests once
npm test

# Watch mode for development
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Linting
```bash
# Check code quality
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

### Project Structure
```
├── manifest.json          # Extension configuration
├── background.js          # Service Worker (core logic)
├── popup.js              # Popup UI logic
├── popup.html            # Popup UI layout
├── _locales/             # i18n translations
├── tests/                # Unit tests
│   ├── setup.js          # Test utilities and mocks
│   └── background.test.js # Background service tests
├── .github/
│   └── workflows/
│       └── test.yml      # GitHub Actions CI/CD
└── package.json          # Dependencies and scripts
```

## How It Works

### Polling Mechanism
- Uses Chrome Alarms API (not `setInterval`) for reliability
- Checks monitored channels every 1 minute
- Survives Service Worker restarts and Chrome termination

### Channel Checking
1. Fetches channel status from Twitch Helix API (`/helix/streams`)
2. Checks all channels in parallel (10+ channels complete in ~1-2 seconds)
3. Updates storage with current status (online/offline/error)
4. Triggers auto-open logic if configured

### Auto-open Logic
- Opens new tab/window when `onLive=true` and `onLiveOpen=true`
- Prevents duplicate tabs (checks existing tabs before opening)
- Supports both individual tabs and multi-twitch mode

### Tab Management
- **Rotation**: Cycles through open stream tabs at set interval
- **Muting**: Automatically mutes all tabs except the active one
- **Auto-close**: Closes tabs when their streams go offline

## API Integration

Uses Twitch Helix API with OAuth 2.0 authentication:
- `GET /helix/streams?user_login={name}` - Check if channel is live
- `GET /helix/users?login={name}` - Get user ID for stream queries

Requires valid OAuth token in extension storage.

## Troubleshooting

### Polling Stops
**Before (v1.0.10)**: Chrome could terminate Service Worker, stopping polling
**Now (v1.0.11+)**: Multiple initialization points ensure alarms persist

Check Chrome DevTools:
1. `chrome://extensions/` → Inspect background service worker
2. Console for: `ensureAlarmsExist called` and `checkStreams started`

### API Errors
Check the service worker console for:
- `Error checking channel {name}:` - API call failed
- `Timeout for {channel}:` - Request exceeded 10 seconds
- `HTTP error 401:` - OAuth token expired/invalid

### Storage Issues
- Clear extension storage: `chrome.storage.local.clear()`
- Re-authenticate via extension popup

## Testing

### Running Tests
```bash
npm test
```

### Test Coverage
- Alarm initialization logic
- Channel status checking (online/offline)
- Parallel processing error handling
- Extension disabled/configuration checks

### CI/CD
GitHub Actions automatically runs on:
- Every push to `main` branch
- Pull requests to `main` branch

Checks run:
- ESLint (code quality)
- Vitest (unit tests)

## Contributing

Pull requests welcome! Please:
1. Ensure `npm test` and `npm run lint` pass
2. Add tests for new functionality
3. Update README if adding features

## License

See LICENSE file (if present)

## Version History

### v1.9.4
- **Chrome Web Store Optimization**: Removed unnecessary `web_accessible_resources` declaration

### v1.9.3
- Updated version numbering and UI polish

### v1.9.0
- **About Page**: Added extenstion information with localization support
- OFUSE donation link integration

### v1.6.0 - v1.8.3
- **Desktop Notifications**:
  - Show notifications when monitored channels go live
  - Display stream title and category in notification
  - Click notification to open channel
  - macOS display improvements

### v1.4.0
- **Category Search UI**: Blocked categories now use incremental search with Twitch API
  - Search categories by name and select from dropdown
  - Display selected categories as tags with delete buttons
  - Works for both global settings and per-channel settings
- **Allowed-Only Category Filter**: Priority system for category filtering
  - Allowed-only list overrides blocked/allowed lists
  - Works for both global and per-channel settings
- **Storage Migration**: Automatic migration from comma-separated format to array format
- **UI Improvements**: Help icons with tooltips for all settings

### v1.2.0
- **Per-channel Volume Control**: Set custom volume for each monitored channel
- **Category Filtering**: Block specific categories from auto-opening
- Default volume set to 100%

### v1.1.0
- **New Features**:
  - Skip sponsored/branded content streams (is_branded_content filter)
  - Block specific categories (comma-separated list, e.g., "Just Chatting, ASMR")
  - Context menu "Open with Miteruyo" for Twitch channel links
  - Tabs opened from popup button are now managed (rotation, mute, auto-close)
- **Bug Fixes**:
  - Tab rotation interval now has a minimum of 1 minute
  - Auto-close only works for actual channel pages (not directory, settings, etc.)

### v1.0.12
- Fix Service Worker polling reliability with proper alarm initialization
- Parallelize channel checking to avoid 30s timeout limit
- Add error handling and 10s timeout for API calls
- Add GitHub Actions CI/CD with automated testing
- Add Vitest unit tests and ESLint configuration
- Fix multiple windows opening when no existing window exists
  - Now first channel creates window, subsequent channels open as tabs
- Fix Invalid URL errors when filtering tabs
  - Handle non-http URLs (chrome://, about:blank, etc.)
  - Add try-catch protection in URL parsing
- Fix auto-close not working with single tab
  - Check for offline channels during every polling cycle
  - No longer depends on tab activation event

### v1.0.10 and earlier
- Initial features and functionality
