# CLAUDE.md

# LAW
research the industry-standard approach to this problem use it to guide yours"

作業を subagent および task agent に適切に移譲し, コンテキストを節約してください

作業内容は厳しくレビューを受けること。
- 自己レビュー
- gemini-cli レビュー
- codex レビュー

コードの重複や簡潔性、無駄なファイルを作っていないかどうか、使いやすさ、
セキュリティリスク、コストなどのあらゆる点について厳しく指摘するよう指示してください

レビュー修正した後は再度レビューを受け、レビューの指摘が完全にクリアされるまで、修正とレビューを>繰り返せ

- テストに失敗したら、作業に関係なくとも、修正すること

## review aspects
- Code quality and best practices
- Potential bugs and edge cases
- Performance implications
- Security considerations
- **コードの簡潔性**: 過度な抽象化や複雑化を避ける
- 単体テストのカバレッジは十分か？
- YAGNI の原則に乗っ取り、過剰な実装と設計を避ける

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Miteruyo is a Chrome Extension (Manifest V3) that monitors Twitch channels and automatically opens streams when they go live. It uses the Twitch Helix API for stream status checking and Chrome Alarms API for reliable Service Worker polling.

## Development Commands

```bash
npm install          # Install dependencies
npm test             # Run tests once
npm run test:watch   # Watch mode for TDD
npm run test:coverage # Generate coverage report
npm run lint         # Check code quality
npm run lint:fix     # Auto-fix linting issues
npm run screenshot   # Take popup screenshot (saves to screenshots/latest.png)
npm run screenshot -- --channel  # Include channel settings panel
```

### UI Screenshot Testing

Puppeteerを使用してChrome拡張機能のポップアップUIをスクリーンショットで確認できます。

- スクリプト: `scripts/screenshot.cjs`
- 出力先: `screenshots/latest.png`
- 機能: ダミーデータを挿入してログイン状態をシミュレート、設定パネルを自動展開

## Architecture

### Core Files
- **background.js** - Service Worker containing core logic: stream polling, tab management, alarm handling, context menu
- **popup.js** - Extension popup UI logic: channel list management, settings, Twitch OAuth
- **popup.html** - Popup UI layout using Bootstrap 5

### Key Mechanisms
- **Chrome Alarms API** (not setInterval) for reliable 1-minute polling that survives Service Worker restarts
- **Parallel channel checking** with 10-second timeout per request to avoid 30-second Service Worker limits
- **Tab/Window management** via chrome.tabs and chrome.windows APIs
- **Context Menu** for "Open with Miteruyo" on Twitch links

### Storage Schema (chrome.storage.local)
- `channels[]` - Array of channel objects with name, onLive, onLiveOpen, status, game_name, game_id, tags, title, is_branded_content
- `oauth_token` - Twitch OAuth token
- `isEnabled`, `isOpenNewWindow`, `isEnabledTabRotation`, `isEnabledTabMute`, `isEnabledAutoClose` - Feature flags
- `isSkipBrandedContent` - Skip sponsored/branded content streams
- `blockedCategoryNames` - Comma-separated category names to block
- `tabRotationInterval` - Minutes between tab rotations (minimum: 1)
- `lastOpenWindowId` - Target window for tab management

### Helper Functions (background.js)
- `isTwitchChannelPage(url)` - Check if URL is a Twitch channel page (not directory/settings/etc.)
- `shouldOpenChannel(channel)` - Check if channel should auto-open based on filters
- `openInManagedWindow(channelName)` - Open tab in Miteruyo-managed window

### Testing
- Vitest with Chrome API mocks in tests/setup.js
- Tests focus on alarm initialization, channel status checking, parallel processing

### i18n
- Default locale: Japanese (`_locales/ja/`)
- Also supports English (`_locales/en/`)

## Implementation Notes

実装おわりにREADMEとテストをアップデートし、テストを実行すること

