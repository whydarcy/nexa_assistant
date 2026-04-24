'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
const electron_1 = require('electron')
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
	executeCommand: (command, args) =>
		electron_1.ipcRenderer.invoke('execute-command', command, args),
	windowMinimize: () => electron_1.ipcRenderer.invoke('window-minimize'),
	windowMaximize: () => electron_1.ipcRenderer.invoke('window-maximize'),
	windowClose: () => electron_1.ipcRenderer.invoke('window-close'),
	windowsSpeechInit: () => electron_1.ipcRenderer.invoke('windows-speech-init'),
	windowsSpeechStart: language =>
		electron_1.ipcRenderer.invoke('windows-speech-start', language),
	windowsSpeechStop: () => electron_1.ipcRenderer.invoke('windows-speech-stop'),
	onSapiResult: callback => {
		electron_1.ipcRenderer.on('sapi-result', (event, data) => callback(data))
	},
	removeSapiResultListener: () => {
		electron_1.ipcRenderer.removeAllListeners('sapi-result')
	},
	// System Control
	systemGetVolume: () => electron_1.ipcRenderer.invoke('system-get-volume'),
	systemSetVolume: volume =>
		electron_1.ipcRenderer.invoke('system-set-volume', volume),
	systemIncreaseVolume: step =>
		electron_1.ipcRenderer.invoke('system-increase-volume', step),
	systemDecreaseVolume: step =>
		electron_1.ipcRenderer.invoke('system-decrease-volume', step),
	systemMuteVolume: () => electron_1.ipcRenderer.invoke('system-mute-volume'),
	systemGetInfo: () => electron_1.ipcRenderer.invoke('system-get-info'),
	// Advanced System Control
	systemOpenApp: appName =>
		electron_1.ipcRenderer.invoke('system-open-app', appName),
	systemLaunchFile: filePath =>
		electron_1.ipcRenderer.invoke('system-launch-file', filePath),
	systemOpenFolderSmart: folderHint =>
		electron_1.ipcRenderer.invoke('system-open-folder-smart', folderHint),
	systemExecPowerShell: command =>
		electron_1.ipcRenderer.invoke('system-exec-powershell', command),
	systemMaximizeWindow: windowTitle =>
		electron_1.ipcRenderer.invoke('system-maximize-window', windowTitle),
	systemMinimizeWindow: windowTitle =>
		electron_1.ipcRenderer.invoke('system-minimize-window', windowTitle),
	systemCloseWindow: windowTitle =>
		electron_1.ipcRenderer.invoke('system-close-window', windowTitle),
	systemWait: milliseconds =>
		electron_1.ipcRenderer.invoke('system-wait', milliseconds),
	// Advanced Input Control
	systemSendKeys: keys =>
		electron_1.ipcRenderer.invoke('system-send-keys', keys),
	systemClick: (x, y, button) =>
		electron_1.ipcRenderer.invoke('system-click', x, y, button),
	systemMouseDown: (x, y, button) =>
		electron_1.ipcRenderer.invoke('system-mouse-down', x, y, button),
	systemMouseUp: button =>
		electron_1.ipcRenderer.invoke('system-mouse-up', button),
	systemMoveMouse: (x, y) =>
		electron_1.ipcRenderer.invoke('system-move-mouse', x, y),
	systemScroll: (x, y, delta, direction) =>
		electron_1.ipcRenderer.invoke('system-scroll', x, y, delta, direction),
	systemDoubleClick: (x, y) =>
		electron_1.ipcRenderer.invoke('system-double-click', x, y),
	systemGetScreenSize: () =>
		electron_1.ipcRenderer.invoke('system-get-screen-size'),
	// Browser Control
	browserOpenUrl: (url, browser) =>
		electron_1.ipcRenderer.invoke('browser-open-url', url, browser),
	browserSearch: (query, browser) =>
		electron_1.ipcRenderer.invoke('browser-search', query, browser),
	browserNewTab: (url, browser) =>
		electron_1.ipcRenderer.invoke('browser-new-tab', url, browser),
	browserCloseTab: browser =>
		electron_1.ipcRenderer.invoke('browser-close-tab', browser),
	browserRefresh: browser =>
		electron_1.ipcRenderer.invoke('browser-refresh', browser),
	browserGoBack: browser =>
		electron_1.ipcRenderer.invoke('browser-go-back', browser),
	browserGoForward: browser =>
		electron_1.ipcRenderer.invoke('browser-go-forward', browser),
	browserGetUrl: browser =>
		electron_1.ipcRenderer.invoke('browser-get-url', browser),
	// Installed browsers
	getInstalledBrowsers: () =>
		electron_1.ipcRenderer.invoke('get-installed-browsers'),
	// GPU Crash notifications
	onGpuCrash: callback => {
		electron_1.ipcRenderer.on('gpu-crash-notification', (event, data) =>
			callback(data),
		)
	},
	removeGpuCrashListener: () => {
		electron_1.ipcRenderer.removeAllListeners('gpu-crash-notification')
	},
	// App path
	getAppPath: () => electron_1.ipcRenderer.invoke('get-app-path'),
	// Whisper handlers
	whisperCheck: () => electron_1.ipcRenderer.invoke('whisper-check'),
	whisperStart: () => electron_1.ipcRenderer.invoke('whisper-start'),
	whisperStop: () => electron_1.ipcRenderer.invoke('whisper-stop'),
	whisperRecognize: (audioBuffer, mimeType) =>
		electron_1.ipcRenderer.invoke('whisper-recognize', audioBuffer, mimeType),
	// App version
	getAppVersion: () => electron_1.ipcRenderer.invoke('get-app-version'),
	// Update handlers
	checkForUpdates: () => electron_1.ipcRenderer.invoke('check-for-updates'),
	downloadUpdate: () => electron_1.ipcRenderer.invoke('download-update'),
	installUpdate: () => electron_1.ipcRenderer.invoke('install-update'),
	// Update event listeners
	onUpdateChecking: callback => {
		electron_1.ipcRenderer.on('checking-for-update', () => callback())
	},
	onUpdateAvailable: callback => {
		electron_1.ipcRenderer.on('update-available', (event, info) =>
			callback(info),
		)
	},
	onUpdateNotAvailable: callback => {
		electron_1.ipcRenderer.on('update-not-available', (event, info) =>
			callback(info),
		)
	},
	onDownloadProgress: callback => {
		electron_1.ipcRenderer.on('download-progress', (event, progress) =>
			callback(progress),
		)
	},
	onUpdateDownloaded: callback => {
		electron_1.ipcRenderer.on('update-downloaded', (event, info) =>
			callback(info),
		)
	},
	onUpdateError: callback => {
		electron_1.ipcRenderer.on('update-error', (event, error) => callback(error))
	},
	// DevTools
	openDevTools: () => electron_1.ipcRenderer.invoke('open-devtools'),
	closeDevTools: () => electron_1.ipcRenderer.invoke('close-devtools'),
	devtoolsToggle: () => electron_1.ipcRenderer.invoke('devtools-toggle'),
	getCurrentUserInfo: () =>
		electron_1.ipcRenderer.invoke('get-current-user-info'),
	telegramUserStatus: () =>
		electron_1.ipcRenderer.invoke('telegram-user-status'),
	telegramUserLoginStart: payload =>
		electron_1.ipcRenderer.invoke('telegram-user-login-start', payload),
	telegramUserLoginCode: payload =>
		electron_1.ipcRenderer.invoke('telegram-user-login-code', payload),
	telegramUserLoginPassword: payload =>
		electron_1.ipcRenderer.invoke('telegram-user-login-password', payload),
	telegramUserLogout: () =>
		electron_1.ipcRenderer.invoke('telegram-user-logout'),
	telegramUserSend: payload =>
		electron_1.ipcRenderer.invoke('telegram-user-send', payload),
	telegramUserReplyLast: payload =>
		electron_1.ipcRenderer.invoke('telegram-user-reply-last', payload),
	telegramUserReadLast: payload =>
		electron_1.ipcRenderer.invoke('telegram-user-read-last', payload),
})
