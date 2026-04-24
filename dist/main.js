'use strict'
var __createBinding =
	(this && this.__createBinding) ||
	(Object.create
		? function (o, m, k, k2) {
				if (k2 === undefined) k2 = k
				var desc = Object.getOwnPropertyDescriptor(m, k)
				if (
					!desc ||
					('get' in desc ? !m.__esModule : desc.writable || desc.configurable)
				) {
					desc = {
						enumerable: true,
						get: function () {
							return m[k]
						},
					}
				}
				Object.defineProperty(o, k2, desc)
			}
		: function (o, m, k, k2) {
				if (k2 === undefined) k2 = k
				o[k2] = m[k]
			})
var __setModuleDefault =
	(this && this.__setModuleDefault) ||
	(Object.create
		? function (o, v) {
				Object.defineProperty(o, 'default', { enumerable: true, value: v })
			}
		: function (o, v) {
				o['default'] = v
			})
var __importStar =
	(this && this.__importStar) ||
	(function () {
		var ownKeys = function (o) {
			ownKeys =
				Object.getOwnPropertyNames ||
				function (o) {
					var ar = []
					for (var k in o)
						if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k
					return ar
				}
			return ownKeys(o)
		}
		return function (mod) {
			if (mod && mod.__esModule) return mod
			var result = {}
			if (mod != null)
				for (var k = ownKeys(mod), i = 0; i < k.length; i++)
					if (k[i] !== 'default') __createBinding(result, mod, k[i])
			__setModuleDefault(result, mod)
			return result
		}
	})()
Object.defineProperty(exports, '__esModule', { value: true })
const electron_1 = require('electron')
const path = __importStar(require('path'))
const child_process_1 = require('child_process')
const os = __importStar(require('os'))
const util_1 = require('util')
const execAsync = (0, util_1.promisify)(child_process_1.exec)
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile)
const fs = require('fs')
const { spawn } = require('child_process')
const { Tray, Menu, nativeImage } = electron_1
let mainWindow = null
let whisperProcess = null // Процесс Whisper Python скрипта
let appTray = null // Системный трей

// =========================
// Helpers: safer URL opening + browser detection
// =========================
async function openExternalUrl(url) {
	try {
		// Самый надежный способ в Electron
		await electron_1.shell.openExternal(url)
		return { success: true, message: `URL "${url}" открыт` }
	} catch (e) {
		return { error: `Не удалось открыть URL через shell: ${e.message}` }
	}
}

async function getInstalledBrowsersMac() {
	return [
		{ id: 'safari', name: 'Safari', command: 'open -a Safari' },
		{ id: 'chrome', name: 'Google Chrome', command: 'open -a "Google Chrome"' },
		{ id: 'firefox', name: 'Firefox', command: 'open -a Firefox' },
		{ id: 'edge', name: 'Microsoft Edge', command: 'open -a "Microsoft Edge"' },
		{ id: 'opera', name: 'Opera', command: 'open -a Opera' },
		{ id: 'brave', name: 'Brave', command: 'open -a Brave' },
	]
}

function runOsascript(script) {
	const escaped = script.replace(/'/g, "'\\''")
	return execAsync(`osascript -e '${escaped}'`)
}

async function runOsascriptSafe(script) {
	try {
		const { stdout, stderr } = await runOsascript(script)
		return { success: true, output: (stdout || stderr || '').trim() }
	} catch (e) {
		return { success: false, error: e.message }
	}
}

async function getInstalledBrowsersWin() {
	try {
		if (process.platform !== 'win32') return []
		// Реестр StartMenuInternet + известные exe
		const ps = [
			`$ErrorActionPreference = "SilentlyContinue";`,
			`$items = @();`,
			`$roots = @("HKLM:\\SOFTWARE\\Clients\\StartMenuInternet","HKCU:\\SOFTWARE\\Clients\\StartMenuInternet");`,
			`foreach ($root in $roots) {`,
			`  if (Test-Path $root) {`,
			`    Get-ChildItem $root | ForEach-Object {`,
			`      $k = $_;`,
			`      $id = $k.PSChildName;`,
			`      $name = (Get-ItemProperty $k.PSPath)."(default)";`,
			`      if (-not $name -or $name -eq "") { $name = $id }`,
			`      $cmdKey = Join-Path $k.PSPath "shell\\open\\command";`,
			`      $cmd = (Get-ItemProperty $cmdKey)."(default)";`,
			`      if ($cmd) { $items += [pscustomobject]@{ id=$id; name=$name; command=$cmd } }`,
			`    }`,
			`  }`,
			`}`,
			`$known = @(`,
			`  @{ id="chrome";  name="Google Chrome"; exe="chrome.exe" },`,
			`  @{ id="edge";    name="Microsoft Edge"; exe="msedge.exe" },`,
			`  @{ id="firefox"; name="Mozilla Firefox"; exe="firefox.exe" },`,
			`  @{ id="opera";   name="Opera"; exe="opera.exe" },`,
			`  @{ id="brave";   name="Brave"; exe="brave.exe" },`,
			`  @{ id="yandex";  name="Яндекс.Браузер"; exe="browser.exe" }`,
			`);`,
			`foreach ($b in $known) {`,
			`  $p = (Get-Command $b.exe).Source;`,
			`  if ($p) { $items += [pscustomobject]@{ id=$b.id; name=$b.name; command=("\"{0}\"" -f $p) } }`,
			`}`,
			`$items | Group-Object id | ForEach-Object { $_.Group | Select-Object -First 1 } | ConvertTo-Json -Compress`,
		].join(' ')
		const command = `powershell -Command "${ps.replace(/"/g, '\\"')}"`
		const { stdout, stderr } = await execAsync(command)
		const raw = (stdout || stderr || '').trim()
		if (!raw) return []
		// Вырезаем JSON
		let jsonText = raw
		const firstBracket = raw.indexOf('[')
		const firstBrace = raw.indexOf('{')
		const start =
			firstBracket === -1
				? firstBrace
				: firstBrace === -1
					? firstBracket
					: Math.min(firstBracket, firstBrace)
		if (start !== -1) {
			const lastBracket = raw.lastIndexOf(']')
			const lastBrace = raw.lastIndexOf('}')
			const end = Math.max(lastBracket, lastBrace)
			if (end !== -1 && end > start) {
				jsonText = raw.slice(start, end + 1)
			}
		}
		const parsed = JSON.parse(jsonText)
		if (Array.isArray(parsed)) return parsed
		if (parsed && typeof parsed === 'object') return [parsed]
		return []
	} catch (e) {
		console.error('Get installed browsers error:', e)
		return []
	}
}

// Флаг для определения, выходим ли мы из приложения
electron_1.app.isQuiting = false

// КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Настройки для предотвращения вылетов GPU
// Проблема: конфликт GPU между Electron и Яндекс Музыкой
electron_1.app.commandLine.appendSwitch('disable-gpu-compositing') // Отключаем GPU композитинг
electron_1.app.commandLine.appendSwitch('disable-software-rasterizer') // Отключаем программный растеризатор
electron_1.app.commandLine.appendSwitch('disable-gpu-sandbox') // Отключаем GPU sandbox
electron_1.app.commandLine.appendSwitch('disable-webgl') // Отключаем WebGL для предотвращения конфликтов
electron_1.app.commandLine.appendSwitch('disable-2d-canvas-image-chromium') // Отключаем 2D canvas ускорение
electron_1.app.commandLine.appendSwitch('disable-accelerated-2d-canvas') // Отключаем ускорение 2D canvas
electron_1.app.commandLine.appendSwitch('disable-accelerated-video-decode') // Отключаем ускорение декодирования видео
electron_1.app.commandLine.appendSwitch('disable-background-networking') // Отключаем фоновые сетевые запросы
electron_1.app.commandLine.appendSwitch('disable-background-timer-throttling') // Отключаем throttling таймеров
electron_1.app.commandLine.appendSwitch('disable-renderer-backgrounding') // Предотвращаем фоновый рендеринг
electron_1.app.commandLine.appendSwitch(
	'disable-features',
	'VizDisplayCompositor',
) // Отключаем Viz композитор

// Ограничиваем использование GPU памяти
electron_1.app.commandLine.appendSwitch('max-gum-fps', '60') // Ограничиваем FPS
electron_1.app.commandLine.appendSwitch('disable-gpu-vsync') // Отключаем VSync

// Обработка ошибок GPU
electron_1.app.on('gpu-process-crashed', (event, killed) => {
	console.error('⚠️ GPU процесс упал:', killed ? 'убит' : 'не убит')
	// Не перезапускаем GPU процесс автоматически
	event.preventDefault()
})

electron_1.app.on('render-process-gone', (event, webContents, details) => {
	console.error('⚠️ Render процесс упал:', details.reason)
	if (details.reason === 'crashed' || details.reason === 'killed') {
		console.error('⚠️ Критическая ошибка рендеринга. Перезапуск окна...')
		// Перезапускаем окно при критической ошибке
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.reload()
		}
	}
})

// Оптимизированный автообновлятель
function initAutoUpdater() {
	try {
		const { autoUpdater } = require('electron-updater')

		// Оптимизация: быстрая проверка и загрузка обновлений
		autoUpdater.autoDownload = false // Не загружаем автоматически
		autoUpdater.autoInstallOnAppQuit = true // Устанавливаем при выходе

		// Оптимизация скорости загрузки
		autoUpdater.requestHeaders = {
			'Cache-Control': 'no-cache',
			Pragma: 'no-cache',
		}

		// Увеличиваем скорость загрузки
		autoUpdater.downloadedUpdateHelper = null

		// Проверяем обновления при запуске (не блокируем запуск)
		setTimeout(() => {
			autoUpdater.checkForUpdatesAndNotify().catch(err => {
				console.warn('Ошибка проверки обновлений при запуске:', err.message)
			})
		}, 3000) // Проверяем через 3 секунды после запуска

		// Событие: обновление доступно
		autoUpdater.on('update-available', info => {
			console.log('🔄 Обновление доступно:', info.version)
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send('update-available', info)
			}
		})

		// Событие: прогресс загрузки
		autoUpdater.on('download-progress', progressObj => {
			const percent = Math.round(progressObj.percent)
			const transferred =
				Math.round((progressObj.transferred / 1024 / 1024) * 100) / 100
			const total = Math.round((progressObj.total / 1024 / 1024) * 100) / 100
			console.log(
				`📥 Загрузка обновления: ${percent}% (${transferred} MB / ${total} MB)`,
			)
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send('download-progress', {
					percent,
					transferred,
					total,
					bytesPerSecond: progressObj.bytesPerSecond,
				})
			}
		})

		// Событие: обновление загружено
		autoUpdater.on('update-downloaded', info => {
			console.log('✅ Обновление загружено:', info.version)
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send('update-downloaded', info)
			}
		})

		// Событие: ошибка при обновлении
		autoUpdater.on('error', error => {
			console.error('❌ Ошибка автообновления:', error)
			let errorMessage = error.message

			// Более понятные сообщения об ошибках
			if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
				errorMessage =
					'Файл обновлений не найден на сервере. Убедитесь, что файл latest.yml загружен на сервер по адресу https://nexa-api.ballistik.tech/app/updates'
			} else if (
				errorMessage.includes('network') ||
				errorMessage.includes('ECONNREFUSED')
			) {
				errorMessage =
					'Не удалось подключиться к серверу обновлений. Проверьте подключение к интернету.'
			}

			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send('update-error', errorMessage)
			}
		})

		// Событие: проверка обновлений
		autoUpdater.on('checking-for-update', () => {
			console.log('🔍 Проверка обновлений...')
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send('checking-for-update')
			}
		})

		// Событие: обновлений нет
		autoUpdater.on('update-not-available', info => {
			console.log('✅ Обновлений нет, текущая версия актуальна')
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send('update-not-available', info)
			}
		})

		// IPC обработчик: загрузить обновление
		electron_1.ipcMain.handle('download-update', async () => {
			try {
				await autoUpdater.downloadUpdate()
				return { success: true }
			} catch (error) {
				console.error('Ошибка загрузки обновления:', error)
				return { success: false, error: error.message }
			}
		})

		// IPC обработчик: установить обновление и закрыть приложение
		electron_1.ipcMain.handle('install-update', async () => {
			try {
				console.log('🔄 Начинаем установку обновления...')

				// Устанавливаем флаг выхода
				electron_1.app.isQuiting = true

				// Закрываем трей перед установкой обновления
				if (appTray && !appTray.isDestroyed()) {
					appTray.destroy()
					appTray = null
					console.log('✅ Трей закрыт')
				}

				// Закрываем все окна
				const windows = electron_1.BrowserWindow.getAllWindows()
				console.log(`🔄 Закрываем ${windows.length} окон...`)
				windows.forEach(window => {
					if (!window.isDestroyed()) {
						window.removeAllListeners('close')
						window.destroy()
					}
				})

				// Даем время на закрытие окон
				await new Promise(resolve => setTimeout(resolve, 500))

				// Устанавливаем обновление и перезапускаем
				// false = не перезапускаем немедленно, true = закрываем все окна перед установкой
				console.log('🔄 Вызываем quitAndInstall...')
				autoUpdater.quitAndInstall(false, true)

				// Принудительно выходим из приложения через небольшую задержку
				setTimeout(() => {
					console.log('🔄 Принудительный выход из приложения...')
					electron_1.app.quit()
				}, 1000)

				return { success: true }
			} catch (error) {
				console.error('❌ Ошибка установки обновления:', error)
				return { success: false, error: error.message }
			}
		})

		// IPC обработчик: проверить обновления вручную
		electron_1.ipcMain.handle('check-for-updates', async () => {
			try {
				const result = await autoUpdater.checkForUpdates()
				return { success: true, updateInfo: result?.updateInfo }
			} catch (error) {
				console.error('Ошибка проверки обновлений:', error)
				let errorMessage = error.message

				// Более понятные сообщения об ошибках
				if (
					errorMessage.includes('404') ||
					errorMessage.includes('Not Found')
				) {
					errorMessage =
						'Файл обновлений не найден на сервере. Убедитесь, что файл latest.yml загружен на сервер по адресу https://nexa-api.ballistik.tech/app/updates'
				} else if (
					errorMessage.includes('network') ||
					errorMessage.includes('ECONNREFUSED')
				) {
					errorMessage =
						'Не удалось подключиться к серверу обновлений. Проверьте подключение к интернету.'
				}

				return { success: false, error: errorMessage }
			}
		})

		console.log('✅ Автообновление инициализировано')
	} catch (error) {
		console.warn(
			'⚠️ Автообновление недоступно (возможно, не установлен electron-updater):',
			error.message,
		)
	}
}

function getIconPath() {
	const res =
		process.resourcesPath ||
		path.join(path.dirname(process.execPath), 'resources')
	const candidates = electron_1.app.isPackaged
		? [
				path.join(res, 'icon.ico'),
				path.join(__dirname, '..', 'build', 'icon.ico'),
			]
		: [
				path.join(__dirname, '..', 'build', 'icon.ico'),
				path.join(electron_1.app.getAppPath(), 'build', 'icon.ico'),
				path.join(res, 'icon.ico'),
				path.join(process.cwd(), 'build', 'icon.ico'),
			]
	for (const p of candidates) {
		if (p && fs.existsSync(p)) return p
	}
	return path.join(__dirname, '..', 'build', 'icon.ico')
}

function createWindow() {
	mainWindow = new electron_1.BrowserWindow({
		width: 1200,
		height: 800,
		title: 'Nexa',
		frame: false,
		transparent: false,
		backgroundColor: '#000000',
		icon: getIconPath(),
		show: false, // Не показываем окно до полной загрузки
		webPreferences: {
			preload: (function () {
				var p = path.join(__dirname, 'preload.js')
				if (fs.existsSync(p)) return p
				var appPath = electron_1.app.getAppPath()
				var fallback = path.join(appPath, 'dist', 'preload.js')
				return fs.existsSync(fallback) ? fallback : p
			})(),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true, // Включена безопасность веб-контента
			allowRunningInsecureContent: false, // Запрещаем небезопасный контент
			experimentalFeatures: false, // Отключаем экспериментальные функции для безопасности
			devTools: !electron_1.app.isPackaged, // Отключаем DevTools в production
			enableRemoteModule: false,
			sandbox: false, // Отключаем sandbox (может потребоваться для некоторых функций)
			partition: 'persist:main', // Используем персистентную сессию для сохранения localStorage
			// Content Security Policy для уменьшения предупреждений
			// В dev режиме разрешаем unsafe-eval для работы с динамическим кодом
			// В production это предупреждение не будет показываться
			contentSecurityPolicy: electron_1.app.isPackaged
				? "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https: http:; img-src 'self' data: https: http:; media-src 'self' blob: data:; worker-src 'self' blob:;"
				: "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https: http:; img-src 'self' data: https: http:; media-src 'self' blob: data:; worker-src 'self' blob:;",
			// КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Отключаем аппаратное ускорение для предотвращения конфликтов с GPU
			offscreen: false, // Отключаем offscreen рендеринг
			backgroundThrottling: false, // Отключаем throttling фоновых процессов
		},
		resizable: true,
		show: true,
	})
	var appRoot = electron_1.app.getAppPath()
	var htmlPath = path.join(__dirname, '..', 'renderer', 'index.html')
	if (!fs.existsSync(htmlPath)) {
		htmlPath = path.join(appRoot, 'renderer', 'index.html')
	}
	if (!electron_1.app.isPackaged) {
		console.log('Загрузка файла:', htmlPath)
	}
	mainWindow.loadFile(htmlPath)

	// Открываем DevTools только в режиме разработки
	if (process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged) {
		mainWindow.webContents.openDevTools()
	}
	// В production режиме не блокируем DevTools, но не открываем автоматически
	// Пользователь может открыть через F12 или IPC команду

	// Разрешаем открытие DevTools через F12 в production
	mainWindow.webContents.on('before-input-event', (event, input) => {
		if (input.key === 'F12') {
			if (mainWindow.webContents.isDevToolsOpened()) {
				mainWindow.webContents.closeDevTools()
			} else {
				mainWindow.webContents.openDevTools()
			}
		}
	})

	// Добавляем IPC обработчик для открытия DevTools
	electron_1.ipcMain.handle('open-devtools', () => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.openDevTools()
			return { success: true }
		}
		return { success: false }
	})

	electron_1.ipcMain.handle('close-devtools', () => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.closeDevTools()
			return { success: true }
		}
		return { success: false }
	})

	// Обработчик закрытия окна - минимизируем в трей вместо закрытия
	mainWindow.on('close', event => {
		// Если не выходим из приложения, минимизируем в трей
		if (!electron_1.app.isQuiting) {
			event.preventDefault()
			mainWindow.hide()

			// Создаем трей, если его еще нет
			if (!appTray) {
				createTray()
			}

			// Показываем уведомление в трее (если поддерживается)
			if (appTray && !appTray.isDestroyed()) {
				appTray.setToolTip('Nexa работает в фоне. Кликните для открытия.')
			}
		} else {
			// Если выходим, закрываем окно и трей
			if (appTray) {
				appTray.destroy()
			}
			mainWindow = null
		}
	})

	mainWindow.on('closed', () => {
		mainWindow = null
	})

	// КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Обработка ошибок GPU для окна
	mainWindow.webContents.on('gpu-crashed', (event, killed) => {
		console.error('⚠️ GPU процесс окна упал:', killed ? 'убит' : 'не убит')
		// Не перезапускаем автоматически, чтобы избежать бесконечного цикла
		if (!killed) {
			// Показываем уведомление пользователю
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send('gpu-crash-notification', {
					message:
						'Обнаружена проблема с GPU. Приложение будет работать в безопасном режиме.',
				})
			}
		}
	})

	mainWindow.webContents.on('render-process-gone', (event, details) => {
		console.error('⚠️ Render процесс окна упал:', details.reason)
		if (details.reason === 'crashed') {
			// Перезагружаем окно только если это не критическая ошибка GPU
			setTimeout(() => {
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.reload()
				}
			}, 1000)
		}
	})

	// Ограничиваем использование памяти
	mainWindow.webContents.on('did-finish-load', () => {
		// Очищаем кэш периодически для предотвращения утечек памяти
		setInterval(() => {
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.session.clearCache()
			}
		}, 300000) // Каждые 5 минут
	})
}
electron_1.app.whenReady().then(async () => {
	// Vosk удален, используем Whisper через faster-whisper
	console.log('✅ Приложение готово, используем Whisper для распознавания речи')

	electron_1.session.defaultSession.setPermissionRequestHandler(
		(webContents, permission, callback, details) => {
			console.log(
				'🔐 Запрос разрешения:',
				permission,
				'от',
				details.requestingUrl || 'локальный файл',
			)

			// Автоматически разрешаем доступ к микрофону и камере
			if (permission === 'media') {
				console.log('✅ Разрешен доступ к микрофону/камере')
				callback(true)
				return
			}

			// Разрешаем доступ к уведомлениям
			if (permission === 'notifications') {
				console.log('✅ Разрешен доступ к уведомлениям')
				callback(true)
				return
			}

			// Для других разрешений также разрешаем по умолчанию (для совместимости)
			console.log('✅ Разрешение предоставлено по умолчанию:', permission)
			callback(true)
		},
	)

	// Обработчик проверки разрешений
	electron_1.session.defaultSession.setPermissionCheckHandler(
		(webContents, permission, requestingOrigin, details) => {
			console.log(
				'🔍 Проверка разрешения:',
				permission,
				'от',
				requestingOrigin || 'локальный файл',
			)

			// Всегда разрешаем доступ к микрофону
			if (permission === 'media') {
				console.log('✅ Проверка доступа к микрофону: разрешено')
				return true
			}

			// Для других разрешений возвращаем true по умолчанию
			return true
		},
	)

	// Инициализируем автообновление (только для собранной версии)
	if (electron_1.app.isPackaged) {
		initAutoUpdater()
	}

	createWindow()

	// Создаем трей при запуске приложения
	createTray()

	electron_1.app.on('activate', () => {
		if (electron_1.BrowserWindow.getAllWindows().length === 0) {
			createWindow()
		} else {
			// Если окно скрыто, показываем его
			if (mainWindow) {
				mainWindow.show()
				mainWindow.focus()
			}
		}
	})
})
// Создаем системный трей
function createTray() {
	const iconPath = getIconPath()
	let trayIcon = nativeImage.createFromPath(iconPath)
	if (!trayIcon || trayIcon.isEmpty()) {
		console.warn(`⚠️ Иконка трея не найдена: ${iconPath}`)
		trayIcon = nativeImage.createEmpty()
	} else {
		console.log(`✅ Иконка трея загружена: ${iconPath}`)
	}

	// Создаем трей
	appTray = new Tray(trayIcon)
	appTray.setToolTip('Nexa')

	// Создаем контекстное меню для трея
	const contextMenu = Menu.buildFromTemplate([
		{
			label: 'Показать Nexa',
			click: () => {
				if (mainWindow) {
					mainWindow.show()
					mainWindow.focus()
				} else {
					createWindow()
				}
			},
		},
		{
			label: 'Скрыть',
			click: () => {
				if (mainWindow) {
					mainWindow.hide()
				}
			},
		},
		{ type: 'separator' },
		{
			label: 'Выход',
			type: 'normal',
			click: () => {
				electron_1.app.isQuiting = true
				if (appTray) {
					appTray.destroy()
				}
				if (mainWindow) {
					mainWindow.destroy()
				}
				electron_1.app.quit()
			},
		},
	])

	appTray.setContextMenu(contextMenu)

	// В Windows при правом клике показываем контекстное меню
	// При левом клике показываем/скрываем окно
	if (process.platform === 'win32') {
		// В Windows правый клик показывает контекстное меню автоматически
		// Левый клик - показываем/скрываем окно
		appTray.on('click', (event, bounds) => {
			// Левый клик - показываем/скрываем окно
			if (mainWindow) {
				if (mainWindow.isVisible()) {
					mainWindow.hide()
				} else {
					mainWindow.show()
					mainWindow.focus()
				}
			} else {
				createWindow()
			}
		})
	} else {
		// В других ОС используем стандартное поведение
		appTray.on('click', () => {
			if (mainWindow) {
				if (mainWindow.isVisible()) {
					mainWindow.hide()
				} else {
					mainWindow.show()
					mainWindow.focus()
				}
			} else {
				createWindow()
			}
		})
	}
}

// Обработчик закрытия окна - минимизируем в трей вместо закрытия
electron_1.app.on('window-all-closed', e => {
	// Не закрываем приложение, если закрыты все окна
	// Приложение будет работать в фоне через трей
	e.preventDefault()

	// Создаем трей, если его еще нет
	if (!appTray) {
		createTray()
	}

	// Скрываем все окна
	if (mainWindow) {
		mainWindow.hide()
	}
})
electron_1.ipcMain.handle('window-minimize', () => {
	if (mainWindow) mainWindow.minimize()
})
electron_1.ipcMain.handle('window-maximize', () => {
	if (mainWindow) {
		if (mainWindow.isMaximized()) {
			mainWindow.unmaximize()
		} else {
			mainWindow.maximize()
		}
	}
})
electron_1.ipcMain.handle('window-close', () => {
	if (mainWindow) {
		// При закрытии через IPC минимизируем в трей
		electron_1.app.isQuiting = false
		mainWindow.hide()

		// Создаем трей, если его еще нет
		if (!appTray) {
			createTray()
		}
	}
})

electron_1.ipcMain.handle('window-close-force', () => {
	// Принудительное закрытие приложения
	electron_1.app.isQuiting = true
	if (mainWindow) {
		mainWindow.close()
	}
	if (appTray) {
		appTray.destroy()
	}
	electron_1.app.quit()
})
electron_1.ipcMain.handle('devtools-toggle', () => {
	// Разрешаем переключение DevTools всегда
	if (mainWindow && !mainWindow.isDestroyed()) {
		if (mainWindow.webContents.isDevToolsOpened()) {
			mainWindow.webContents.closeDevTools()
		} else {
			mainWindow.webContents.openDevTools()
		}
		return { success: true }
	}
	return { success: false }
})
// System Control handlers
electron_1.ipcMain.handle('system-get-volume', async () => {
	try {
		if (process.platform === 'darwin') {
			const { stdout } = await execAsync(
				"osascript -e 'output volume of (get volume settings)'",
			)
			const v = parseInt(String(stdout).trim(), 10)
			return {
				success: true,
				volume: isNaN(v) ? 50 : Math.min(100, Math.max(0, v)),
			}
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		// Используем правильный метод через AudioDeviceCmdlets
		const command = `powershell -Command "Import-Module -Name AudioDeviceCmdlets -ErrorAction SilentlyContinue; $volume = (Get-AudioDevice -PlaybackVolume).Volume; Write-Output $volume"`
		try {
			const { stdout } = await execAsync(command)
			const volumeStr = stdout.trim()
			const volumeFloat = parseFloat(volumeStr)
			if (!isNaN(volumeFloat) && volumeFloat >= 0 && volumeFloat <= 1) {
				const volume = Math.round(volumeFloat * 100)
				return { success: true, volume }
			}
		} catch (e) {
			console.warn(
				'Первый метод получения громкости не сработал, пробуем альтернативный...',
			)
		}

		// Альтернативный метод через Windows Audio API
		const altCommand = `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Audio { [DllImport(\"user32.dll\")] public static extern int SendMessageW(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam); }'; $result = [Audio]::SendMessageW([IntPtr]0xFFFF, 0x319, [IntPtr]0, [IntPtr]0); $volume = if ($result -ge 0) { $result / 65535.0 } else { 0.5 }; Write-Output $volume"`
		try {
			const { stdout } = await execAsync(altCommand)
			const volumeStr = stdout.trim()
			const volumeFloat = parseFloat(volumeStr)
			if (!isNaN(volumeFloat) && volumeFloat >= 0 && volumeFloat <= 1) {
				const volume = Math.round(volumeFloat * 100)
				return { success: true, volume }
			}
		} catch (e) {
			console.warn('Альтернативный метод также не сработал')
		}

		// Если ничего не сработало, возвращаем значение по умолчанию
		console.warn(
			'Не удалось получить громкость, используем значение по умолчанию 50%',
		)
		return { success: true, volume: 50 }
	} catch (error) {
		console.error('Get volume error:', error)
		// Возвращаем значение по умолчанию вместо ошибки
		return { success: true, volume: 50 }
	}
})
electron_1.ipcMain.handle('system-set-volume', async (event, volume) => {
	try {
		if (process.platform === 'darwin') {
			const clampedVolume = Math.max(
				0,
				Math.min(100, Math.round(Number(volume) || 0)),
			)
			await execAsync(
				`osascript -e 'set volume output volume ${clampedVolume}'`,
			)
			return { success: true, volume: clampedVolume }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		if (isNaN(volume) || volume < 0 || volume > 100) {
			return { error: 'Громкость должна быть числом от 0 до 100' }
		}
		const clampedVolume = Math.max(0, Math.min(100, Math.round(volume)))
		let command = `powershell -Command "Import-Module -Name AudioDeviceCmdlets -ErrorAction SilentlyContinue; Set-AudioDevice -PlaybackVolume ${clampedVolume}; Write-Output ${clampedVolume}"`
		try {
			await execAsync(command)
			return { success: true, volume: clampedVolume }
		} catch (e) {
			console.warn('AudioDeviceCmdlets не найден, пробуем установить модуль...')
		}
		try {
			await execAsync(
				'powershell -Command "Install-Module -Name AudioDeviceCmdlets -Scope CurrentUser -Force -AllowClobber -ErrorAction SilentlyContinue"',
			)
			await execAsync(command)
			return { success: true, volume: clampedVolume }
		} catch (e2) {
			console.error(
				'Установка модуля или Set-AudioDevice не удалась:',
				e2.message,
			)
		}
		return {
			error:
				'Не удалось изменить громкость. Установите вручную: PowerShell → Install-Module AudioDeviceCmdlets -Scope CurrentUser',
		}
	} catch (error) {
		console.error('Set volume error:', error)
		return { error: error.message || 'Ошибка установки громкости' }
	}
})
electron_1.ipcMain.handle(
	'system-increase-volume',
	async (event, step = 10) => {
		try {
			if (process.platform === 'darwin') {
				const { stdout } = await execAsync(
					"osascript -e 'output volume of (get volume settings)'",
				)
				let v = parseInt(String(stdout).trim(), 10)
				if (isNaN(v)) v = 50
				const s = Math.max(1, Math.min(100, Math.round(Number(step) || 10)))
				const newVol = Math.min(100, v + s)
				await execAsync(`osascript -e 'set volume output volume ${newVol}'`)
				return { success: true, volume: newVol }
			}
			if (process.platform !== 'win32') {
				return { error: 'Только для Windows' }
			}
			// Валидация шага
			if (isNaN(step) || step <= 0) {
				step = 10
			}
			step = Math.max(1, Math.min(100, Math.round(step)))

			// Получаем текущую громкость
			let currentVolume = 50 // Значение по умолчанию
			try {
				const getVolumeCommand = `powershell -Command "Import-Module -Name AudioDeviceCmdlets -ErrorAction SilentlyContinue; $vol = (Get-AudioDevice -PlaybackVolume).Volume; Write-Output $vol"`
				const { stdout } = await execAsync(getVolumeCommand)
				const volumeStr = stdout.trim()
				const volumeFloat = parseFloat(volumeStr)
				if (!isNaN(volumeFloat) && volumeFloat >= 0 && volumeFloat <= 1) {
					currentVolume = Math.round(volumeFloat * 100)
				} else if (
					!isNaN(volumeFloat) &&
					volumeFloat >= 0 &&
					volumeFloat <= 100
				) {
					currentVolume = Math.round(volumeFloat)
				}
			} catch (e) {
				console.warn(
					'Не удалось получить текущую громкость, используем значение по умолчанию:',
					e.message,
				)
			}

			const newVolume = Math.min(100, currentVolume + step)
			let setVolumeCommand = `powershell -Command "Import-Module -Name AudioDeviceCmdlets -ErrorAction SilentlyContinue; Set-AudioDevice -PlaybackVolume ${newVolume}; Write-Output ${newVolume}"`
			try {
				await execAsync(setVolumeCommand)
				return { success: true, volume: newVolume }
			} catch (e) {
				await execAsync(
					'powershell -Command "Install-Module -Name AudioDeviceCmdlets -Scope CurrentUser -Force -AllowClobber -ErrorAction SilentlyContinue"',
				)
				await execAsync(setVolumeCommand)
				return { success: true, volume: newVolume }
			}
		} catch (error) {
			console.error('Increase volume error:', error)
			return { error: error.message || 'Ошибка увеличения громкости' }
		}
	},
)
electron_1.ipcMain.handle(
	'system-decrease-volume',
	async (event, step = 10) => {
		try {
			if (process.platform === 'darwin') {
				const { stdout } = await execAsync(
					"osascript -e 'output volume of (get volume settings)'",
				)
				let v = parseInt(String(stdout).trim(), 10)
				if (isNaN(v)) v = 50
				const s = Math.max(1, Math.min(100, Math.round(Number(step) || 10)))
				const newVol = Math.max(0, v - s)
				await execAsync(`osascript -e 'set volume output volume ${newVol}'`)
				return { success: true, volume: newVol }
			}
			if (process.platform !== 'win32') {
				return { error: 'Только для Windows' }
			}
			if (isNaN(step) || step <= 0) {
				step = 10
			}
			step = Math.max(1, Math.min(100, Math.round(step)))

			let currentVolume = 50
			try {
				const getVolumeCommand = `powershell -Command "Import-Module -Name AudioDeviceCmdlets -ErrorAction SilentlyContinue; $vol = (Get-AudioDevice -PlaybackVolume).Volume; Write-Output $vol"`
				const { stdout } = await execAsync(getVolumeCommand)
				const volumeStr = stdout.trim()
				const volumeFloat = parseFloat(volumeStr)
				if (!isNaN(volumeFloat) && volumeFloat >= 0 && volumeFloat <= 1) {
					currentVolume = Math.round(volumeFloat * 100)
				} else if (
					!isNaN(volumeFloat) &&
					volumeFloat >= 0 &&
					volumeFloat <= 100
				) {
					currentVolume = Math.round(volumeFloat)
				}
			} catch (e) {
				console.warn(
					'Не удалось получить текущую громкость, используем значение по умолчанию:',
					e.message,
				)
			}

			const newVolume = Math.max(0, currentVolume - step)
			let setVolumeCommand = `powershell -Command "Import-Module -Name AudioDeviceCmdlets -ErrorAction SilentlyContinue; Set-AudioDevice -PlaybackVolume ${newVolume}; Write-Output ${newVolume}"`
			try {
				await execAsync(setVolumeCommand)
				return { success: true, volume: newVolume }
			} catch (e) {
				await execAsync(
					'powershell -Command "Install-Module -Name AudioDeviceCmdlets -Scope CurrentUser -Force -AllowClobber -ErrorAction SilentlyContinue"',
				)
				await execAsync(setVolumeCommand)
				return { success: true, volume: newVolume }
			}
		} catch (error) {
			console.error('Decrease volume error:', error)
			return { error: error.message || 'Ошибка уменьшения громкости' }
		}
	},
)
electron_1.ipcMain.handle('system-mute-volume', async () => {
	try {
		if (process.platform === 'darwin') {
			await execAsync("osascript -e 'set volume output volume 0'")
			return { success: true, volume: 0 }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		let command = `powershell -Command "Import-Module -Name AudioDeviceCmdlets -ErrorAction SilentlyContinue; Set-AudioDevice -PlaybackVolume 0; Write-Output 0"`
		try {
			await execAsync(command)
			return { success: true, volume: 0 }
		} catch (e) {
			await execAsync(
				'powershell -Command "Install-Module -Name AudioDeviceCmdlets -Scope CurrentUser -Force -AllowClobber -ErrorAction SilentlyContinue"',
			)
			await execAsync(command)
			return { success: true, volume: 0 }
		}
	} catch (error) {
		console.error('Mute volume error:', error)
		return { error: error.message || 'Ошибка отключения звука' }
	}
})
electron_1.ipcMain.handle('system-get-info', async () => {
	console.log('📊 Запрос системной информации...')
	try {
		const platform = os.platform()
		const arch = os.arch()
		const hostname = os.hostname()
		const totalMem = os.totalmem()
		const freeMem = os.freemem()
		const uptime = os.uptime()
		let systemInfo = {
			platform,
			arch,
			hostname,
			totalMemory: Math.round((totalMem / 1024 / 1024 / 1024) * 100) / 100, // GB
			freeMemory: Math.round((freeMem / 1024 / 1024 / 1024) * 100) / 100, // GB
			usedMemory:
				Math.round(((totalMem - freeMem) / 1024 / 1024 / 1024) * 100) / 100, // GB
			memoryUsage: Math.round((1 - freeMem / totalMem) * 100), // %
			uptime: Math.round(uptime / 3600), // hours
		}
		console.log('✅ Базовая информация получена:', systemInfo)
		// Для Windows получаем детальную информацию через PowerShell
		if (process.platform === 'win32') {
			try {
				// Версия Windows - более точная информация
				const winVersionCommand =
					'powershell -Command "Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption"'
				try {
					const { stdout: winVersion } = await execAsync(winVersionCommand)
					const osCaption = winVersion.trim()
					// Получаем архитектуру отдельно
					const archCommand =
						'powershell -Command "Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty OSArchitecture"'
					try {
						const { stdout: arch } = await execAsync(archCommand)
						systemInfo.osVersion = `${osCaption} ${arch.trim()}`
					} catch (e) {
						systemInfo.osVersion = osCaption
					}
				} catch (e) {
					// Fallback
					try {
						const winVersionCommand2 =
							'powershell -Command "[System.Environment]::OSVersion.VersionString"'
						const { stdout: winVersion2 } = await execAsync(winVersionCommand2)
						systemInfo.osVersion = winVersion2.trim()
					} catch (e2) {
						systemInfo.osVersion = 'Windows'
					}
				}
				// Процессор - используем Get-CimInstance для более точной информации
				const cpuCommand =
					'powershell -Command "Get-CimInstance Win32_Processor | Select-Object -First 1 | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, CurrentClockSpeed | ConvertTo-Json"'
				try {
					const { stdout: cpuInfo } = await execAsync(cpuCommand)
					console.log('CPU raw output:', cpuInfo)
					const cpuData = JSON.parse(cpuInfo)
					console.log('CPU parsed data:', cpuData)
					if (cpuData && cpuData.Name) {
						systemInfo.cpuModel = cpuData.Name.trim()
						systemInfo.cpuCount = cpuData.NumberOfCores || 0
						systemInfo.cpuThreads = cpuData.NumberOfLogicalProcessors || 0
						if (cpuData.MaxClockSpeed) {
							systemInfo.cpuSpeed = `${(cpuData.MaxClockSpeed / 1000).toFixed(2)} GHz`
						} else if (cpuData.CurrentClockSpeed) {
							systemInfo.cpuSpeed = `${(cpuData.CurrentClockSpeed / 1000).toFixed(2)} GHz`
						}
						console.log(
							'CPU info set:',
							systemInfo.cpuModel,
							systemInfo.cpuCount,
							systemInfo.cpuThreads,
						)
					}
				} catch (e) {
					console.error('CPU info error:', e)
					// Fallback на WMI
					try {
						const cpuCommand2 =
							'powershell -Command "Get-WmiObject Win32_Processor | Select-Object -First 1 | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed | ConvertTo-Json"'
						const { stdout: cpuInfo2 } = await execAsync(cpuCommand2)
						console.log('CPU fallback raw output:', cpuInfo2)
						const cpuData2 = JSON.parse(cpuInfo2)
						if (cpuData2 && cpuData2.Name) {
							systemInfo.cpuModel = cpuData2.Name.trim()
							systemInfo.cpuCount = cpuData2.NumberOfCores || 0
							systemInfo.cpuThreads = cpuData2.NumberOfLogicalProcessors || 0
							if (cpuData2.MaxClockSpeed) {
								systemInfo.cpuSpeed = `${(cpuData2.MaxClockSpeed / 1000).toFixed(2)} GHz`
							}
						}
					} catch (e2) {
						console.error('CPU fallback error:', e2)
						const cpus = os.cpus()
						systemInfo.cpuModel = cpus[0]?.model || 'Неизвестно'
						systemInfo.cpuCount = cpus.length
					}
				}
				// Видеокарта
				const gpuCommand =
					"powershell -Command \"Get-CimInstance Win32_VideoController | Where-Object {$_.Name -notlike '*Basic*' -and $_.Name -notlike '*Standard*' -and $_.AdapterRAM} | Select-Object -First 1 | Select-Object Name, AdapterRAM | ConvertTo-Json\""
				try {
					const { stdout: gpuInfo } = await execAsync(gpuCommand)
					const gpuData = JSON.parse(gpuInfo)
					if (gpuData && gpuData.Name) {
						systemInfo.gpu = gpuData.Name.trim()
						if (gpuData.AdapterRAM && gpuData.AdapterRAM > 0) {
							const gpuRamGB =
								Math.round((gpuData.AdapterRAM / 1024 / 1024 / 1024) * 100) /
								100
							systemInfo.gpuRam = `${gpuRamGB} GB`
						}
					}
				} catch (e) {
					console.error('GPU info error:', e)
				}
				// Информация о дисках - упрощенная и более надежная версия
				try {
					// Сначала получаем логические диски
					const logicalDisksCommand =
						'powershell -Command "Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -eq 3} | Select-Object DeviceID, Size, FreeSpace | ConvertTo-Json"'
					const { stdout: logicalDisksInfo } =
						await execAsync(logicalDisksCommand)
					console.log('Logical disks raw:', logicalDisksInfo)
					const logicalDisks = JSON.parse(logicalDisksInfo)
					const disksArray = Array.isArray(logicalDisks)
						? logicalDisks
						: [logicalDisks]
					console.log('Logical disks parsed:', disksArray)
					// Получаем физические диски для определения типа
					const physicalDisksCommand =
						'powershell -Command "Get-CimInstance Win32_DiskDrive | Select-Object Model, MediaType, InterfaceType, Size | ConvertTo-Json"'
					let physicalDisks = []
					try {
						const { stdout: physicalDisksInfo } =
							await execAsync(physicalDisksCommand)
						const parsed = JSON.parse(physicalDisksInfo)
						physicalDisks = Array.isArray(parsed) ? parsed : [parsed]
						console.log('Physical disks:', physicalDisks)
					} catch (e) {
						console.error('Physical disks error:', e)
					}
					// Сопоставляем логические и физические диски
					systemInfo.disks = disksArray
						.map(ld => {
							if (!ld.Size || !ld.FreeSpace) {
								return null
							}
							// Округляем до целых GB для более читаемого формата
							const sizeGB = Math.round(ld.Size / 1024 / 1024 / 1024)
							const freeGB = Math.round(ld.FreeSpace / 1024 / 1024 / 1024)
							const usedGB = sizeGB - freeGB
							// Определяем тип диска
							let diskType = 'HDD'
							// Ищем соответствующий физический диск по размеру (примерное совпадение)
							const matchingPhysical = physicalDisks.find(pd => {
								if (!pd.Size) return false
								const pdSizeGB = Math.round(pd.Size / 1024 / 1024 / 1024)
								return Math.abs(pdSizeGB - sizeGB) < 100 // Допуск 100GB
							})
							if (matchingPhysical) {
								const model = (matchingPhysical.Model || '').toUpperCase()
								const mediaType = (
									matchingPhysical.MediaType || ''
								).toUpperCase()
								const interfaceType = (
									matchingPhysical.InterfaceType || ''
								).toUpperCase()
								if (
									model.includes('SSD') ||
									model.includes('NVME') ||
									model.includes('M.2') ||
									mediaType.includes('SSD') ||
									mediaType.includes('SOLID STATE') ||
									interfaceType.includes('NVME') ||
									(interfaceType.includes('SATA') && model.includes('SSD'))
								) {
									diskType = 'SSD'
								}
							}
							return {
								DeviceID: ld.DeviceID,
								'Size(GB)': sizeGB,
								'FreeSpace(GB)': freeGB,
								'UsedSpace(GB)': usedGB,
								Type: diskType,
							}
						})
						.filter(d => d !== null)
					console.log('Final disks info:', systemInfo.disks)
				} catch (e) {
					console.error('Disk info error:', e)
					// Fallback на простую версию
					try {
						const diskCommand2 =
							"powershell -Command \"Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -eq 3} | Select-Object DeviceID, @{Name='Size(GB)';Expression={[math]::Round($_.Size/1GB,0)}}, @{Name='FreeSpace(GB)';Expression={[math]::Round($_.FreeSpace/1GB,0)}}, @{Name='UsedSpace(GB)';Expression={[math]::Round(($_.Size-$_.FreeSpace)/1GB,0)}} | ConvertTo-Json\""
						const { stdout: diskInfo2 } = await execAsync(diskCommand2)
						const disks2 = JSON.parse(diskInfo2)
						if (Array.isArray(disks2)) {
							systemInfo.disks = disks2.map(d => ({ ...d, Type: 'Неизвестно' }))
						} else if (disks2) {
							systemInfo.disks = [{ ...disks2, Type: 'Неизвестно' }]
						}
					} catch (e2) {
						console.error('Disk fallback error:', e2)
					}
				}
				// Сетевая информация
				const networkCommand =
					"powershell -Command \"Get-NetAdapter | Where-Object {$_.Status -eq 'Up' -and $_.InterfaceDescription -notlike '*Virtual*'} | Select-Object Name, InterfaceDescription, LinkSpeed | ConvertTo-Json\""
				try {
					const { stdout: networkInfo } = await execAsync(networkCommand)
					const networkData = JSON.parse(networkInfo)
					if (Array.isArray(networkData) && networkData.length > 0) {
						systemInfo.network = networkData.map(adapter => ({
							name: adapter.Name,
							type:
								adapter.InterfaceDescription?.includes('Wi-Fi') ||
								adapter.InterfaceDescription?.includes('Wireless') ||
								adapter.InterfaceDescription?.includes('WLAN')
									? 'Wi-Fi'
									: 'Ethernet',
							speed: adapter.LinkSpeed,
						}))
					} else if (networkData && networkData.Name) {
						systemInfo.network = [
							{
								name: networkData.Name,
								type:
									networkData.InterfaceDescription?.includes('Wi-Fi') ||
									networkData.InterfaceDescription?.includes('Wireless') ||
									networkData.InterfaceDescription?.includes('WLAN')
										? 'Wi-Fi'
										: 'Ethernet',
								speed: networkData.LinkSpeed,
							},
						]
					}
				} catch (e) {
					console.error('Network info error:', e)
				}
				// Батарея (для ноутбуков)
				const batteryCommand =
					'powershell -Command "Get-CimInstance Win32_Battery | Select-Object BatteryStatus, EstimatedChargeRemaining | ConvertTo-Json"'
				try {
					const { stdout: batteryInfo } = await execAsync(batteryCommand)
					const batteryData = JSON.parse(batteryInfo)
					if (Array.isArray(batteryData) && batteryData.length > 0) {
						systemInfo.battery = {
							status:
								batteryData[0].BatteryStatus === 2
									? 'Заряжается'
									: batteryData[0].BatteryStatus === 1
										? 'Разряжается'
										: 'Неизвестно',
							charge: batteryData[0].EstimatedChargeRemaining
								? `${batteryData[0].EstimatedChargeRemaining}%`
								: 'Неизвестно',
						}
					} else if (batteryData && batteryData.BatteryStatus !== undefined) {
						systemInfo.battery = {
							status:
								batteryData.BatteryStatus === 2
									? 'Заряжается'
									: batteryData.BatteryStatus === 1
										? 'Разряжается'
										: 'Неизвестно',
							charge: batteryData.EstimatedChargeRemaining
								? `${batteryData.EstimatedChargeRemaining}%`
								: 'Неизвестно',
						}
					} else {
						systemInfo.battery = { status: 'Не обнаружена (стационарный ПК)' }
					}
				} catch (e) {
					systemInfo.battery = { status: 'Не обнаружена (стационарный ПК)' }
				}
			} catch (e) {
				console.error('Windows info error:', e)
				// Fallback на базовую информацию
				const cpus = os.cpus()
				systemInfo.cpuModel = cpus[0]?.model || 'Неизвестно'
				systemInfo.cpuCount = cpus.length
			}
		} else {
			// Для других платформ используем os.cpus()
			const cpus = os.cpus()
			systemInfo.cpuModel = cpus[0]?.model || 'Неизвестно'
			systemInfo.cpuCount = cpus.length
		}
		console.log('✅ Системная информация собрана:', systemInfo)
		return { success: true, info: systemInfo }
	} catch (error) {
		console.error('❌ Get system info error:', error)
		console.error('Stack:', error.stack)
		// Все равно возвращаем базовую информацию, если возможно
		try {
			const platform = os.platform()
			const arch = os.arch()
			const hostname = os.hostname()
			const totalMem = os.totalmem()
			const freeMem = os.freemem()
			const cpus = os.cpus()
			return {
				success: true,
				info: {
					platform,
					arch,
					hostname,
					totalMemory: Math.round((totalMem / 1024 / 1024 / 1024) * 100) / 100,
					freeMemory: Math.round((freeMem / 1024 / 1024 / 1024) * 100) / 100,
					usedMemory:
						Math.round(((totalMem - freeMem) / 1024 / 1024 / 1024) * 100) / 100,
					memoryUsage: Math.round((1 - freeMem / totalMem) * 100),
					cpuModel: cpus[0]?.model || 'Неизвестно',
					cpuCount: cpus.length,
					error: 'Не удалось получить полную информацию, показана базовая',
				},
			}
		} catch (fallbackError) {
			console.error('❌ Fallback error:', fallbackError)
			return { error: error.message || 'Ошибка получения информации о системе' }
		}
	}
})
// Windows Speech Recognition handlers
let windowsSpeechProcess = null
let isWindowsSpeechListening = false
electron_1.ipcMain.handle('get-app-version', async () => {
	try {
		return electron_1.app.getVersion()
	} catch (error) {
		return '1.2.3'
	}
})
electron_1.ipcMain.handle('get-app-path', async () => {
	try {
		const path_1 = require('path')
		// В dev режиме возвращаем путь к проекту, в production - к ресурсам
		if (electron_1.app.isPackaged) {
			return path_1.join(electron_1.app.getAppPath(), 'resources', 'app')
		} else {
			return process.cwd()
		}
	} catch (error) {
		console.error('Error getting app path:', error)
		return process.cwd()
	}
})

// Helper: путь к Whisper в зависимости от платформы (Windows: .exe, macOS: .py + python3)
function getWhisperPath() {
	const isMac = process.platform === 'darwin'
	if (isMac) {
		const appPath = electron_1.app.isPackaged
			? path.join(process.resourcesPath, 'resources', 'whisper', 'whisper_recognition.py')
			: path.join(electron_1.app.getAppPath(), 'resources', 'whisper', 'whisper_recognition.py')
		const candidates = [
			appPath,
			path.join(electron_1.app.getAppPath(), 'resources', 'whisper', 'whisper_recognition.py'),
			path.join(process.cwd(), 'resources', 'whisper', 'whisper_recognition.py'),
		]
		for (const p of candidates) {
			if (p && fs.existsSync(p))
				return { scriptPath: p, type: 'python', executable: 'python3' }
		}
		return {
			scriptPath: null,
			type: 'python',
			executable: 'python3',
			error: `whisper_recognition.py не найден. Пути: ${candidates.join(', ')}`,
		}
	}
	const appPath = electron_1.app.isPackaged
		? path.join(process.resourcesPath, 'resources', 'whisper', 'whisper_recognition.exe')
		: path.join(electron_1.app.getAppPath(), 'resources', 'whisper', 'whisper_recognition.exe')
	const altPath1 = path.join(
		electron_1.app.getAppPath(),
		'resources',
		'whisper',
		'whisper_recognition.exe',
	)
	const altPath2 = path.join(process.cwd(), 'resources', 'whisper', 'whisper_recognition.exe')
	const altPath3 = path.join(
		process.cwd(),
		'resources',
		'whisper',
		'whisper_recognition.exe',
	)
	const candidates = [appPath, altPath1, altPath2, altPath3]
	for (const p of candidates) {
		if (p && fs.existsSync(p)) return { scriptPath: p, type: 'exe' }
	}
	return {
		scriptPath: null,
		type: 'exe',
		error: `whisper_recognition.exe не найден. Пути: ${candidates.join(', ')}`,
	}
}

// Whisper handlers
electron_1.ipcMain.handle('whisper-check', async () => {
	try {
		const { scriptPath, type, error: err } = getWhisperPath()
		if (scriptPath && fs.existsSync(scriptPath)) {
			return { available: true, scriptPath, type }
		}
		return { available: false, error: err || 'Whisper не найден' }
	} catch (error) {
		return { available: false, error: error.message }
	}
})

electron_1.ipcMain.handle('whisper-start', async () => {
	try {
		if (whisperProcess) {
			return { success: true, message: 'Whisper уже запущен' }
		}
		const { scriptPath, type, executable, error: err } = getWhisperPath()
		if (!scriptPath || !fs.existsSync(scriptPath)) {
			return { success: false, error: err || 'Whisper не найден' }
		}
		const spawnArgs = type === 'python' ? [scriptPath] : []
		const spawnCmd = type === 'python' ? executable || 'python3' : scriptPath
		whisperProcess = spawn(spawnCmd, spawnArgs, {
			stdio: ['pipe', 'pipe', 'pipe'],
		})

		whisperProcess.on('error', error => {
			console.error('❌ Ошибка запуска Whisper:', error)
			whisperProcess = null
		})

		whisperProcess.on('exit', code => {
			console.log(`🛑 Whisper процесс завершен с кодом: ${code}`)
			whisperProcess = null
		})

		return { success: true }
	} catch (error) {
		return { success: false, error: error.message }
	}
})

electron_1.ipcMain.handle('whisper-stop', async () => {
	try {
		if (whisperProcess) {
			whisperProcess.kill()
			whisperProcess = null
			return { success: true }
		}
		return { success: true, message: 'Whisper не был запущен' }
	} catch (error) {
		return { success: false, error: error.message }
	}
})

electron_1.ipcMain.handle(
	'whisper-recognize',
	async (event, audioBuffer, mimeType) => {
		try {
			const { scriptPath, type, executable, error: err } = getWhisperPath()
			if (!scriptPath || !fs.existsSync(scriptPath)) {
				return { success: false, error: err || 'Whisper не найден' }
			}
			// Создаем временный файл для аудио
			const tempDir = os.tmpdir()
			// Определяем расширение файла на основе MIME типа
			let fileExt = '.webm' // По умолчанию WebM
			if (mimeType) {
				if (mimeType.includes('wav')) {
					fileExt = '.wav'
				} else if (mimeType.includes('mp3')) {
					fileExt = '.mp3'
				} else if (mimeType.includes('ogg')) {
					fileExt = '.ogg'
				}
			}
			const tempFile = path.join(tempDir, `whisper_${Date.now()}${fileExt}`)

			// Проверяем размер буфера
			if (audioBuffer.byteLength === 0) {
				return { success: false, error: 'Аудио буфер пустой' }
			}

			console.log(
				`📦 Размер аудио буфера: ${(audioBuffer.byteLength / 1024).toFixed(2)} KB, тип: ${mimeType}`,
			)

			// Записываем буфер в файл
			fs.writeFileSync(tempFile, Buffer.from(audioBuffer))

			// Проверяем, что файл записан
			const fileStats = fs.statSync(tempFile)
			if (fileStats.size === 0) {
				return {
					success: false,
					error: 'Не удалось записать аудио файл (размер 0)',
				}
			}

			console.log(
				`💾 Временный файл создан: ${tempFile}, размер: ${(fileStats.size / 1024).toFixed(2)} KB`,
			)
			console.log(`📝 Используем: ${scriptPath}`)

			// Запускаем распознавание через standalone .exe
			// Передаем язык распознавания через переменную окружения (русский по умолчанию)
			const language = 'ru' // Русский язык для распознавания
			return new Promise(resolve => {
				// Устанавливаем переменные окружения для Whisper с улучшенными настройками
				const env = Object.assign({}, process.env, {
					WHISPER_LANGUAGE: language,
					WHISPER_MODEL_SIZE: 'base', // Используем base модель для лучшего качества распознавания
					WHISPER_DEVICE: 'cpu',
					WHISPER_COMPUTE_TYPE: 'int8', // int8 для CPU (быстро и качественно)
				})

				const cmd = type === 'python' ? executable || 'python3' : scriptPath
				const args = type === 'python' ? [scriptPath, tempFile] : [tempFile]
				console.log(
					`🔊 Запуск Whisper: ${cmd} ${args.join(' ')}, язык: ${language}`,
				)

				const recognizeProcess = spawn(cmd, args, {
					encoding: 'utf8',
					env: env,
				})

				let output = ''
				let errorOutput = ''

				recognizeProcess.stdout.setEncoding('utf8')
				recognizeProcess.stderr.setEncoding('utf8')

				recognizeProcess.stdout.on('data', data => {
					output += data.toString('utf8')
				})

				recognizeProcess.stderr.on('data', data => {
					errorOutput += data.toString('utf8')
				})

				recognizeProcess.on('close', code => {
					// Удаляем временный файл
					try {
						fs.unlinkSync(tempFile)
					} catch (e) {
						// Игнорируем ошибки удаления
					}

					console.log(`🔊 Whisper завершен с кодом: ${code}`)
					console.log(`📤 Вывод Whisper (stdout): ${output.substring(0, 500)}`)
					if (errorOutput) {
						console.log(
							`📤 Вывод Whisper (stderr): ${errorOutput.substring(0, 500)}`,
						)
					}

					if (code === 0) {
						try {
							// Пробуем найти JSON в выводе (может быть смешанный вывод)
							const jsonMatch = output.trim().match(/\{[\s\S]*\}/)
							if (jsonMatch) {
								const result = JSON.parse(jsonMatch[0])
								console.log(
									`✅ Whisper распознал: "${result.text}" (язык: ${result.language || 'не указан'})`,
								)
								resolve(result)
							} else {
								console.error(
									`❌ Неверный формат ответа от Whisper. Вывод: ${output.substring(0, 500)}`,
								)
								resolve({
									success: false,
									error:
										'Неверный формат ответа от Whisper: ' +
										output.substring(0, 200),
								})
							}
						} catch (e) {
							console.error(
								`❌ Ошибка парсинга результата Whisper: ${e.message}`,
							)
							resolve({
								success: false,
								error:
									'Ошибка парсинга результата: ' + output.substring(0, 200),
							})
						}
					} else {
						// Пробуем найти JSON в errorOutput или output (ошибки тоже возвращаются как JSON)
						// Python может писать JSON в stdout даже при ошибках
						const combinedOutput = (output + errorOutput).trim()
						try {
							const jsonMatch = combinedOutput.match(/\{[\s\S]*\}/)
							if (jsonMatch) {
								const errorResult = JSON.parse(jsonMatch[0])
								resolve(errorResult)
							} else {
								resolve({
									success: false,
									error: combinedOutput || 'Неизвестная ошибка',
								})
							}
						} catch (e) {
							resolve({
								success: false,
								error: combinedOutput || 'Неизвестная ошибка',
							})
						}
					}
				})

				recognizeProcess.on('error', error => {
					try {
						fs.unlinkSync(tempFile)
					} catch (e) {
						// Игнорируем ошибки удаления
					}
					resolve({ success: false, error: error.message })
				})
			})
		} catch (error) {
			return { success: false, error: error.message }
		}
	},
)

electron_1.ipcMain.handle('windows-speech-init', async () => {
	try {
		// Проверяем, что мы на Windows
		if (process.platform !== 'win32') {
			return {
				error: 'NOT_WINDOWS',
				message: 'Windows Speech Recognition доступен только на Windows',
			}
		}
		return { success: true }
	} catch (error) {
		console.error('Windows Speech init error:', error)
		return { error: error.message || 'UNKNOWN_ERROR' }
	}
})
electron_1.ipcMain.handle(
	'windows-speech-start',
	async (event, language = 'ru-RU') => {
		try {
			if (isWindowsSpeechListening) {
				return { success: true, message: 'Уже слушает' }
			}

			// Проверяем доступные распознаватели речи через PowerShell и пробуем разные форматы
			let actualLanguage = language
			if (language && language.toLowerCase().startsWith('ru')) {
				// Для русского языка пробуем найти рабочий формат
				const russianFormats = [
					{ format: 'ru-RU', code: '1049', name: 'Russian' },
					{ format: 'ru', code: '1049', name: 'Russian' },
					{ format: '1049', code: '1049', name: 'Russian' },
					{ format: 'Russian', code: '1049', name: 'Russian' },
				]

				const child_process_2 = require('child_process')
				const util_1 = require('util')
				const execAsync = util_1.promisify(child_process_2.exec)

				for (const langFormat of russianFormats) {
					try {
						const checkCommand = `powershell -Command "Add-Type -AssemblyName System.Speech; try { $culture = New-Object System.Globalization.CultureInfo('${langFormat.format}'); $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture); Write-Output 'OK' } catch { Write-Output 'NOT_FOUND' }"`
						const { stdout } = await execAsync(checkCommand)

						if (stdout && stdout.includes('OK')) {
							console.log(
								'✅ Найден рабочий формат для русского языка:',
								langFormat.format,
							)
							actualLanguage = langFormat.format
							break
						}
					} catch (checkError) {
						console.log(
							'⚠️ Формат',
							langFormat.format,
							'не сработал, пробуем следующий...',
						)
					}
				}
			}

			console.log('📝 Используем язык для SAPI:', actualLanguage)

			// Используем PowerShell скрипт для локального распознавания речи (работает с русским языком)
			const fs = require('fs')

			// Пробуем найти PowerShell скрипт в разных местах
			const possibleScriptPaths = [
				path.join(__dirname, '../SapiRecognition.ps1'),
				path.join(process.cwd(), 'SapiRecognition.ps1'),
				path.join(__dirname, '../../SapiRecognition.ps1'),
			]

			let scriptPath = null
			for (const script of possibleScriptPaths) {
				if (fs.existsSync(script)) {
					scriptPath = script
					console.log('✅ Найден SapiRecognition.ps1:', script)
					break
				}
			}

			if (!scriptPath) {
				console.error('❌ SapiRecognition.ps1 не найден в следующих местах:')
				possibleScriptPaths.forEach(p => console.error('  -', p))
				return {
					error: 'SAPI_SCRIPT_NOT_FOUND',
					message:
						'SapiRecognition.ps1 не найден. Убедитесь, что файл находится в корне проекта.',
				}
			}

			// Запускаем PowerShell скрипт
			const powershellCommand = `powershell.exe -ExecutionPolicy Bypass -File "${scriptPath}" -Language "${actualLanguage}"`
			console.log('🚀 Запускаем PowerShell скрипт:', powershellCommand)

			windowsSpeechProcess = (0, child_process_1.spawn)(
				'powershell.exe',
				[
					'-ExecutionPolicy',
					'Bypass',
					'-File',
					scriptPath,
					'-Language',
					actualLanguage,
				],
				{
					stdio: ['ignore', 'pipe', 'pipe'],
					detached: false,
					shell: false,
				},
			)

			// Обработка вывода процесса
			windowsSpeechProcess.stdout?.on('data', data => {
				const output = data.toString()
				console.log('SAPI stdout:', output)
				// Если есть ошибка в выводе, отправляем её в renderer
				if (
					output.includes('error') ||
					output.includes('Error') ||
					output.includes('ERROR')
				) {
					if (mainWindow && !mainWindow.isDestroyed()) {
						mainWindow.webContents.send('sapi-result', {
							type: 'error',
							error: output.trim(),
							timestamp: Date.now(),
						})
					}
				}
			})

			windowsSpeechProcess.stderr?.on('data', data => {
				const error = data.toString()
				console.error('SAPI stderr:', error)
				// Отправляем ошибку в renderer
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.webContents.send('sapi-result', {
						type: 'error',
						error: error.trim(),
						timestamp: Date.now(),
					})
				}
			})

			windowsSpeechProcess.on('exit', code => {
				console.log('SAPI process exited with code:', code)
				windowsSpeechProcess = null
				isWindowsSpeechListening = false
			})

			// Отправляем команду start с языком в PowerShell скрипт
			const controlFile = path.join(
				os.homedir(),
				'AppData',
				'Roaming',
				'Nexa',
				'sapi_control.txt',
			)
			const controlDir = path.dirname(controlFile)
			if (!fs.existsSync(controlDir)) {
				fs.mkdirSync(controlDir, { recursive: true })
			}

			// PowerShell скрипт принимает язык напрямую через параметр, но также читает команды из файла
			// Отправляем команду start с языком
			const controlCommand = actualLanguage
				? `start:${actualLanguage}`
				: 'start'
			fs.writeFileSync(controlFile, controlCommand)
			console.log(
				'📝 Отправлена команда в PowerShell скрипт:',
				controlCommand,
				'для языка:',
				actualLanguage,
			)

			isWindowsSpeechListening = true

			// Запускаем мониторинг результатов
			startSapiResultMonitor(event)

			return { success: true }
		} catch (error) {
			console.error('Windows Speech start error:', error)
			isWindowsSpeechListening = false
			if (windowsSpeechProcess) {
				windowsSpeechProcess.kill()
				windowsSpeechProcess = null
			}
			return { error: error.message || 'UNKNOWN_ERROR' }
		}
	},
)

// Мониторинг результатов SAPI
let sapiMonitorInterval = null
function startSapiResultMonitor(event) {
	if (sapiMonitorInterval) {
		clearInterval(sapiMonitorInterval)
	}

	const outputFile = path.join(
		os.homedir(),
		'AppData',
		'Roaming',
		'Nexa',
		'sapi_output.json',
	)
	const fs = require('fs')

	sapiMonitorInterval = setInterval(() => {
		try {
			if (fs.existsSync(outputFile)) {
				const content = fs.readFileSync(outputFile, 'utf-8')
				if (content) {
					const data = JSON.parse(content)

					// Отправляем результат в renderer
					if (mainWindow && !mainWindow.isDestroyed()) {
						mainWindow.webContents.send('sapi-result', data)
					}

					// Очищаем файл после чтения
					fs.writeFileSync(outputFile, '')
				}
			}
		} catch (err) {
			// Игнорируем ошибки чтения
		}
	}, 100) // Проверяем каждые 100ms
}

function stopSapiResultMonitor() {
	if (sapiMonitorInterval) {
		clearInterval(sapiMonitorInterval)
		sapiMonitorInterval = null
	}
}
electron_1.ipcMain.handle('windows-speech-stop', () => {
	try {
		stopSapiResultMonitor()

		// Отправляем команду stop
		const controlFile = path.join(
			os.homedir(),
			'AppData',
			'Roaming',
			'Nexa',
			'sapi_control.txt',
		)
		const fs = require('fs')
		if (fs.existsSync(path.dirname(controlFile))) {
			fs.writeFileSync(controlFile, 'stop')
		}

		if (windowsSpeechProcess) {
			// Даем процессу время остановиться
			setTimeout(() => {
				if (windowsSpeechProcess && !windowsSpeechProcess.killed) {
					windowsSpeechProcess.kill()
				}
				windowsSpeechProcess = null
			}, 500)
		}

		isWindowsSpeechListening = false
		return { success: true }
	} catch (error) {
		console.error('Windows Speech stop error:', error)
		return { error: error.message || 'UNKNOWN_ERROR' }
	}
})
// --- Windows: пути, алиасы приложений, поиск в PATH (без ручных команд пользователя) ---
/** Имя из IPC: пробелы могут приходить как %20 (кодирует renderer). URL не меняем. */
function normalizeAppNameFromIpc(s) {
	const t = String(s || '').trim()
	if (!t) return t
	if (/^https?:\/\//i.test(t) || /^file:\/\//i.test(t)) return t
	return t.replace(/%20/gi, ' ')
}
function expandWindowsEnvPath(input) {
	if (!input || typeof input !== 'string') return ''
	let s = input.trim()
	if (s === '~' || s === '~/') return os.homedir()
	if (s.startsWith('~/') || s.startsWith('~\\'))
		return path.join(os.homedir(), s.slice(2))
	s = s.replace(/%([^%]+)%/g, (_, k) => process.env[k] || `%${k}%`)
	return s
}
const WIN_APP_ALIASES = {
	калькулятор: 'calc',
	блокнот: 'notepad',
	проводник: 'explorer',
	файлы: 'explorer',
	краска: 'mspaint',
	рисовалку: 'mspaint',
	вордпад: 'wordpad',
	'диспетчер задач': 'taskmgr',
	'task manager': 'taskmgr',
	параметры: 'ms-settings:',
	настройки: 'ms-settings:',
	'панель управления': 'control',
	реестр: 'regedit',
	службы: 'services.msc',
	'диспетчер устройств': 'devmgmt.msc',
	'командную строку': 'cmd',
	камера: 'microsoft.windows.camera:',
	// Русские имена → подсказка для поиска .exe (реестр App Paths, ярлыки, Program Files)
	винскп: 'winscp',
	'вин сцп': 'winscp',
	винсцп: 'winscp',
	телеграм: 'telegram',
	телеграмм: 'telegram',
	дискорд: 'discord',
	спотифай: 'spotify',
	стим: 'steam',
	хром: 'chrome',
	'гугл хром': 'chrome',
	эдж: 'msedge',
	'майкрософт эдж': 'msedge',
	опера: 'opera',
	файрфокс: 'firefox',
	мозилла: 'firefox',
	тор: 'tor browser',
	зум: 'zoom',
	скайп: 'skype',
	слак: 'slack',
	нотепад: 'notepad',
	павершелл: 'powershell',
	ворд: 'winword',
	эксель: 'excel',
	аутлук: 'outlook',
	'павер поинт': 'powerpnt',
	'вс код': 'code',
	фигма: 'figma',
}
function resolveWindowsAppQuery(raw) {
	const q = (raw || '').trim()
	if (!q) return q
	const lower = q.toLowerCase()
	if (WIN_APP_ALIASES[lower]) return WIN_APP_ALIASES[lower]
	return q
}
async function tryWhereExecutable(name) {
	const base = (name || '').trim()
	if (!base) return null
	const candidates = [
		base,
		base.toLowerCase().endsWith('.exe') ? base : `${base}.exe`,
	]
	for (const c of candidates) {
		try {
			const { stdout } = await execAsync(`where.exe ${JSON.stringify(c)}`, {
				windowsHide: true,
			})
			const line = stdout.trim().split(/\r?\n/).filter(Boolean)[0]
			if (line && fs.existsSync(line.trim())) return line.trim()
		} catch (_) {
			/* ignore */
		}
	}
	return null
}
/** Варианты строки для поиска .exe: целиком, без пробелов, первое/последнее слово (для App Paths вроде obs64.exe). */
function expandWindowsExeSearchSeeds(seed) {
	const raw = String(seed || '')
		.trim()
		.replace(/\.exe$/i, '')
	if (!raw) return []
	const lower = raw
		.toLowerCase()
		.replace(/['"`\r\n]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	if (!lower || lower.length > 80) return []
	const compact = lower.replace(/[^a-z0-9\u0400-\u04FF]/gi, '')
	const words = lower.split(/\s+/).filter(w => w.length >= 2)
	const ordered = []
	const add = s => {
		if (s && !ordered.includes(s)) ordered.push(s)
	}
	add(lower)
	if (compact !== lower && compact.length >= 2) add(compact)
	if (words.length > 1) {
		add(words.join('-'))
		add(words[0])
		const last = words[words.length - 1]
		if (last && last !== words[0] && last.length >= 3) add(last)
	}
	return ordered.slice(0, 8)
}
/** Реестр App Paths: подбор .exe по подстроке имени (winscp → WinSCP.exe) */
async function findExeInAppPathsRegistry(seed) {
	const ql = (seed || '')
		.trim()
		.toLowerCase()
		.replace(/\.exe$/i, '')
		.replace(/['"`\r\n]/g, '')
	if (!ql || ql.length > 80) return null
	const script = `$ErrorActionPreference='SilentlyContinue'; $q=${JSON.stringify(ql)}; Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like '*.exe' -and $_.PSChildName.ToLower().Contains($q) } | Select-Object -First 24 | ForEach-Object { $p=(Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).'(default)'; if ($p -and (Test-Path -LiteralPath $p)) { $p } } | Select-Object -First 1`
	try {
		const { stdout } = await execAsync(
			`powershell -NoProfile -Command ${JSON.stringify(script)}`,
			{ windowsHide: true, maxBuffer: 1024 * 1024, timeout: 20000 },
		)
		const line = stdout
			.trim()
			.split(/\r?\n/)
			.map(l => l.trim())
			.find(l => /\.(exe|com|bat|cmd)$/i.test(l) && fs.existsSync(l))
		return line || null
	} catch (_) {
		return null
	}
}
/** Ярлыки в меню «Пуск»: имя ярлыка содержит запрос (в т.ч. «OBS Studio.lnk» по подстроке с пробелом или без) */
async function findExeFromStartMenuShortcuts(seed) {
	const ql = (seed || '')
		.trim()
		.toLowerCase()
		.replace(/\.exe$/i, '')
		.replace(/['"`\r\n]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	const qc = ql.replace(/[^a-z0-9\u0400-\u04FF]/gi, '')
	if ((!ql || ql.length < 2) && (!qc || qc.length < 2)) return null
	if (ql.length > 80) return null
	const script = `$ErrorActionPreference='SilentlyContinue'; $ql=${JSON.stringify(ql)}; $qc=${JSON.stringify(qc)}; $sh=New-Object -ComObject WScript.Shell; foreach ($sd in @("$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs","$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs")) { if (-not (Test-Path -LiteralPath $sd)) { continue }; $lnk = Get-ChildItem -LiteralPath $sd -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | Where-Object { $low=$_.Name.ToLower(); $nf=$low.Replace(' ','').Replace('-','').Replace('_',''); ($ql.Length -ge 2 -and $low.Contains($ql)) -or ($qc.Length -ge 2 -and $nf.Contains($qc)) } | Select-Object -First 1; if ($lnk) { $t=$sh.CreateShortcut($lnk.FullName).TargetPath; if ($t -match '\\.(exe|com|bat|cmd)$' -and (Test-Path -LiteralPath $t)) { $t; break } } }`
	try {
		const { stdout } = await execAsync(
			`powershell -NoProfile -Command ${JSON.stringify(script)}`,
			{ windowsHide: true, maxBuffer: 1024 * 1024, timeout: 25000 },
		)
		const line = stdout
			.trim()
			.split(/\r?\n/)
			.map(l => l.trim())
			.find(l => /\.(exe|com|bat|cmd)$/i.test(l) && fs.existsSync(l))
		return line || null
	} catch (_) {
		return null
	}
}
/** Подпапки Program Files с именем, похожим на запрос (в т.ч. папка «OBS Studio» по подстроке с пробелом или компактно obsstudio) */
async function findExeInTopProgramFolders(seed) {
	const raw = String(seed || '')
		.trim()
		.replace(/\.exe$/i, '')
	const ql = raw
		.toLowerCase()
		.replace(/['"`\r\n]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	const qc = ql.replace(/[^a-z0-9\u0400-\u04FF]/gi, '')
	const qLegacy = raw.replace(/[^a-zA-Z0-9\u0400-\u04FF]/gi, '').toLowerCase()
	if (
		(!ql || ql.length < 2) &&
		(!qc || qc.length < 2) &&
		(!qLegacy || qLegacy.length < 2)
	)
		return null
	if (ql.length > 80 || qc.length > 80 || (qLegacy && qLegacy.length > 48))
		return null
	const roots = [
		process.env['ProgramFiles(x86)'],
		process.env.ProgramFiles,
		path.join(os.homedir(), 'AppData', 'Local', 'Programs'),
	].filter(Boolean)
	const script = `$ErrorActionPreference='SilentlyContinue'; $ql=${JSON.stringify(ql)}; $qc=${JSON.stringify(qc)}; $qLegacy=${JSON.stringify(qLegacy)}; $roots=@(${roots.map(r => JSON.stringify(r)).join(',')}); foreach ($root in $roots) { if (-not (Test-Path -LiteralPath $root)) { continue }; $dirs = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object { $n=$_.Name.ToLower(); $nn=$n.Replace(' ','').Replace('-','').Replace('_',''); ($ql.Length -ge 2 -and $n.Contains($ql)) -or ($qc.Length -ge 2 -and $nn.Contains($qc)) -or ($qLegacy.Length -ge 2 -and $n.Contains($qLegacy)) }; foreach ($d in $dirs) { $exe = Get-ChildItem -LiteralPath $d.FullName -Filter *.exe -File -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 1; if ($exe -and (Test-Path -LiteralPath $exe.FullName)) { $exe.FullName; break } } }`
	try {
		const { stdout } = await execAsync(
			`powershell -NoProfile -Command ${JSON.stringify(script)}`,
			{ windowsHide: true, maxBuffer: 1024 * 1024, timeout: 20000 },
		)
		const line = stdout
			.trim()
			.split(/\r?\n/)
			.map(l => l.trim())
			.find(l => l.endsWith('.exe') && fs.existsSync(l))
		return line || null
	} catch (_) {
		return null
	}
}
async function findExecutableOnWindowsLoose(seed) {
	let seeds = expandWindowsExeSearchSeeds(seed)
	if (!seeds.length) {
		const fb = String(seed || '')
			.trim()
			.toLowerCase()
			.replace(/\.exe$/i, '')
			.replace(/['"`\r\n]/g, '')
			.trim()
		if (fb.length >= 2 && fb.length <= 80) seeds = [fb]
	}
	for (const s of seeds) {
		const a = await findExeInAppPathsRegistry(s)
		if (a) return a
	}
	for (const s of seeds) {
		const b = await findExeFromStartMenuShortcuts(s)
		if (b) return b
	}
	for (const s of seeds) {
		const c = await findExeInTopProgramFolders(s)
		if (c) return c
	}
	return null
}
async function openWindowsAppOrPath(appName) {
	let targetPath = expandWindowsEnvPath(appName)
	const shellApi = electron_1.shell
	// explorer "путь" — отдельно (проводник с аргументом)
	const ex = targetPath.match(/^(?:explorer|explorer\.exe)\s+(.+)$/i)
	if (ex) {
		const inner = expandWindowsEnvPath(ex[1].replace(/^["']|["']$/g, ''))
		if (inner && fs.existsSync(inner)) {
			;(0, child_process_1.spawn)('explorer.exe', [inner], {
				detached: true,
				stdio: 'ignore',
			})
			return { success: true, message: `Папка открыта в проводнике` }
		}
	}
	// URI-схемы (ms-settings:, mailto:, spotify: и т.д.) — не путём к диску
	if (
		/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(targetPath) &&
		!/^[a-zA-Z]:\\/.test(targetPath)
	) {
		await shellApi.openExternal(targetPath)
		return { success: true, message: `Открыто` }
	}
	const normalized = targetPath.replace(/\//g, '\\')
	if (fs.existsSync(normalized)) {
		const err = await shellApi.openPath(normalized)
		if (!err)
			return { success: true, message: `Открыто: ${path.basename(normalized)}` }
	}
	const resolved = resolveWindowsAppQuery(targetPath)
	const fromPath = await tryWhereExecutable(resolved)
	if (fromPath) {
		await execFileAsync('cmd.exe', ['/c', 'start', '', fromPath], {
			windowsHide: true,
		})
		return { success: true, message: `Запущено: ${path.basename(fromPath)}` }
	}
	let loosePath = await findExecutableOnWindowsLoose(resolved)
	if (!loosePath && resolved !== targetPath.trim()) {
		loosePath = await findExecutableOnWindowsLoose(targetPath.trim())
	}
	if (loosePath) {
		await execFileAsync('cmd.exe', ['/c', 'start', '', loosePath], {
			windowsHide: true,
		})
		return { success: true, message: `Запущено: ${path.basename(loosePath)}` }
	}
	const looksLikeFsPath = s =>
		/[\\/]/.test(s) || /^\\\\/.test(s) || /\.(exe|com|bat|cmd|msc)$/i.test(s)
	try {
		await execFileAsync('cmd.exe', ['/c', 'start', '', resolved], {
			windowsHide: true,
		})
		return { success: true, message: `Запущено: ${resolved}` }
	} catch (e1) {
		if (looksLikeFsPath(resolved)) {
			try {
				const esc = String(resolved).replace(/'/g, "''")
				await execFileAsync(
					'powershell.exe',
					['-NoProfile', '-Command', `Start-Process -LiteralPath '${esc}'`],
					{ windowsHide: true },
				)
				return { success: true, message: `Запущено: ${resolved}` }
			} catch (e2) {
				return {
					error: `Не удалось открыть «${appName}»: ${e2.message || e1.message}`,
				}
			}
		}
		return {
			error: `Не удалось найти приложение «${appName}». Проверьте, что оно установлено, или укажите полный путь к .exe.`,
		}
	}
}
// Advanced System Control handlers
electron_1.ipcMain.handle('system-open-app', async (event, appName) => {
	try {
		if (process.platform === 'darwin') {
			const target = normalizeAppNameFromIpc(appName)
			if (
				path.isAbsolute(target) ||
				target.startsWith('.') ||
				target.includes('/')
			) {
				const resolved = path.resolve(target)
				if (fs.existsSync(resolved)) {
					await execAsync(`open "${resolved.replace(/"/g, '\\"')}"`)
					return {
						success: true,
						message: `Открыто: ${path.basename(resolved)}`,
					}
				}
			}
			await execAsync(`open -a "${target.replace(/"/g, '\\"')}"`)
			return { success: true, message: `Приложение "${target}" открыто` }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		return await openWindowsAppOrPath(normalizeAppNameFromIpc(appName))
	} catch (error) {
		console.error('Open app error:', error)
		if (process.platform === 'darwin') {
			return { error: `Не удалось открыть "${appName}": ${error.message}` }
		}
		return { error: `Не удалось открыть "${appName}": ${error.message}` }
	}
})
electron_1.ipcMain.handle('system-launch-file', async (event, filePath) => {
	try {
		const expanded = expandWindowsEnvPath(filePath)
		if (process.platform === 'darwin') {
			await execAsync(`open "${expanded.replace(/"/g, '\\"')}"`)
			return { success: true, message: `Открыто` }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		if (!expanded) {
			return { error: 'Пустой путь' }
		}
		const err = await electron_1.shell.openPath(expanded.replace(/\//g, '\\'))
		if (err) return { error: err }
		return { success: true, message: `Открыто: ${path.basename(expanded)}` }
	} catch (error) {
		console.error('Launch file error:', error)
		return { error: `Не удалось открыть: ${error.message}` }
	}
})
/** Открыть папку по имени или пути: короткое имя ищем на Рабочем столе (в т.ч. OneDrive\Desktop), в Документах, Загрузках */
electron_1.ipcMain.handle('system-open-folder-smart', async (event, raw) => {
	try {
		const rawInput = (raw || '').trim()
		if (!rawInput) {
			return { error: 'Пустое имя папки' }
		}
		if (process.platform === 'darwin') {
			const tryPath = path.join(os.homedir(), 'Desktop', rawInput)
			if (fs.existsSync(tryPath) && fs.statSync(tryPath).isDirectory()) {
				const err = await electron_1.shell.openPath(tryPath)
				if (!err) return { success: true, message: `Открыто: ${tryPath}` }
				return { error: err }
			}
			const err = await electron_1.shell.openPath(tryPath)
			if (!err) return { success: true, message: tryPath }
			return { error: err || `Папка «${rawInput}» не найдена на рабочем столе` }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const expanded = expandWindowsEnvPath(rawInput.replace(/\//g, '\\'))
		const looksLikeFullPath =
			/^[a-zA-Z]:\\/.test(expanded) ||
			/^\\\\/.test(expanded) ||
			/^%[^%]+%\\/.test(expanded)
		if (looksLikeFullPath) {
			const err = await electron_1.shell.openPath(expanded)
			if (!err) return { success: true, message: `Открыто: ${expanded}` }
			return { error: err }
		}
		const simple = expanded.replace(/^["']|["']$/g, '').replace(/[\\\/]+$/, '')
		if (!simple || simple.includes('\\') || simple.includes('/')) {
			const err = await electron_1.shell.openPath(expanded)
			if (!err) return { success: true, message: expanded }
			return { error: err }
		}
		const home = os.homedir()
		const candidates = []
		const push = p => {
			if (p && !candidates.includes(p)) candidates.push(p)
		}
		push(path.join(home, 'Desktop', simple))
		push(path.join(home, 'OneDrive', 'Desktop', simple))
		const oneDrive = process.env.OneDrive
		if (oneDrive) push(path.join(oneDrive, 'Desktop', simple))
		push(path.join(home, 'Documents', simple))
		push(path.join(home, 'Downloads', simple))
		const pub = process.env.PUBLIC
		if (pub) push(path.join(pub, 'Desktop', simple))
		for (const p of candidates) {
			try {
				if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
					const err = await electron_1.shell.openPath(p)
					if (!err) return { success: true, message: `Открыто: ${p}` }
				}
			} catch (_) {
				/* ignore */
			}
		}
		return {
			error: `Папка «${rawInput}» не найдена (искали на Рабочем столе, OneDrive Desktop, в Документах и Загрузках).`,
		}
	} catch (error) {
		console.error('system-open-folder-smart:', error)
		return { error: error.message || 'Неизвестная ошибка' }
	}
})
electron_1.ipcMain.handle('system-exec-powershell', async (event, command) => {
	try {
		if (process.platform === 'darwin') {
			const escaped = command.replace(/"/g, '\\"')
			const { stdout, stderr } = await execAsync(`/bin/zsh -c "${escaped}"`, {
				timeout: 60000,
			})
			return {
				success: true,
				output: (stdout || stderr || 'Команда выполнена').trim(),
				message: 'Команда выполнена успешно',
			}
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const fullCommand = `powershell -Command "${command.replace(/"/g, '\\"')}"`
		const { stdout, stderr } = await execAsync(fullCommand)
		return {
			success: true,
			output: stdout || stderr || 'Команда выполнена',
			message: 'Команда выполнена успешно',
		}
	} catch (error) {
		console.error('PowerShell exec error:', error)
		return { error: `Ошибка выполнения команды: ${error.message}` }
	}
})

// Installed browsers (for Settings dropdown)
electron_1.ipcMain.handle('get-installed-browsers', async () => {
	const list =
		process.platform === 'darwin'
			? await getInstalledBrowsersMac()
			: await getInstalledBrowsersWin()
	return { success: true, browsers: list }
})
electron_1.ipcMain.handle(
	'system-maximize-window',
	async (event, windowTitle) => {
		try {
			if (process.platform === 'darwin') {
				const title = (windowTitle || '')
					.replace(/\\/g, '\\\\')
					.replace(/"/g, '\\"')
				await runOsascript(
					`tell application "System Events" to set frontmost of first process whose name contains "${title}" to true`,
				)
				await runOsascript(
					'tell application "System Events" to keystroke "f" using {command down, control down}',
				)
				return { success: true, message: `Окно "${windowTitle}" развернуто` }
			}
			if (process.platform !== 'win32') {
				return { error: 'Только для Windows' }
			}
			const command = `powershell -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.AppActivate('${windowTitle}'); [System.Windows.Forms.SendKeys]::SendWait('%{ENTER}')"`
			await execAsync(command)
			return { success: true, message: `Окно "${windowTitle}" развернуто` }
		} catch (error) {
			console.error('Maximize window error:', error)
			return { error: `Не удалось развернуть окно: ${error.message}` }
		}
	},
)
electron_1.ipcMain.handle(
	'system-minimize-window',
	async (event, windowTitle) => {
		try {
			if (process.platform === 'darwin') {
				const title = (windowTitle || '')
					.replace(/\\/g, '\\\\')
					.replace(/"/g, '\\"')
				await runOsascript(
					`tell application "System Events" to set frontmost of first process whose name contains "${title}" to true`,
				)
				await runOsascript(
					'tell application "System Events" to keystroke "m" using command down',
				)
				return { success: true, message: `Окно "${windowTitle}" свернуто` }
			}
			if (process.platform !== 'win32') {
				return { error: 'Только для Windows' }
			}
			const command = `powershell -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.AppActivate('${windowTitle}'); [System.Windows.Forms.SendKeys]::SendWait('{ESC}')"`
			await execAsync(command)
			return { success: true, message: `Окно "${windowTitle}" свернуто` }
		} catch (error) {
			console.error('Minimize window error:', error)
			return { error: `Не удалось свернуть окно: ${error.message}` }
		}
	},
)
electron_1.ipcMain.handle('system-close-window', async (event, windowTitle) => {
	try {
		if (process.platform === 'darwin') {
			const title = (windowTitle || '')
				.replace(/\\/g, '\\\\')
				.replace(/"/g, '\\"')
			await runOsascript(
				`tell application "System Events" to set frontmost of first process whose name contains "${title}" to true`,
			)
			await runOsascript(
				'tell application "System Events" to keystroke "w" using command down',
			)
			return { success: true, message: `Окно "${windowTitle}" закрыто` }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const command = `powershell -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.AppActivate('${windowTitle}'); Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait('%{F4}')"`
		await execAsync(command)
		return { success: true, message: `Окно "${windowTitle}" закрыто` }
	} catch (error) {
		console.error('Close window error:', error)
		return { error: `Не удалось закрыть окно: ${error.message}` }
	}
})
electron_1.ipcMain.handle('system-wait', async (event, milliseconds) => {
	return new Promise(resolve => {
		setTimeout(() => {
			resolve({
				success: true,
				message: `Ожидание ${milliseconds}мс завершено`,
			})
		}, milliseconds)
	})
})
// Advanced Input Control handlers
electron_1.ipcMain.handle('system-send-keys', async (event, keys) => {
	try {
		if (process.platform === 'darwin') {
			const k = (keys || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
			await runOsascript(`tell application "System Events" to keystroke "${k}"`)
			return { success: true, message: `Клавиши отправлены` }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const escapedKeys = keys.replace(/'/g, "''")
		const command = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escapedKeys}')"`
		await execAsync(command)
		return { success: true, message: `Клавиши "${keys}" отправлены` }
	} catch (error) {
		console.error('Send keys error:', error)
		return { error: `Ошибка отправки клавиш: ${error.message}` }
	}
})
electron_1.ipcMain.handle(
	'system-click',
	async (event, x, y, button = 'left') => {
		try {
			if (process.platform === 'darwin') {
				if (button && button.toLowerCase() === 'right') {
					await runOsascript(
						`tell application "System Events" to click at {${x}, ${y}} with right click`,
					)
				} else {
					await runOsascript(
						`tell application "System Events" to click at {${x}, ${y}}`,
					)
				}
				return { success: true, message: `Клик на (${x}, ${y})` }
			}
			if (process.platform !== 'win32') {
				return { error: 'Только для Windows' }
			}
			const buttonDown = button.toLowerCase() === 'right' ? '0x0008' : '0x0002'
			const buttonUp = button.toLowerCase() === 'right' ? '0x0010' : '0x0004'
			const command = `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Mouse { [DllImport(\\\"user32.dll\\\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\\\"user32.dll\\\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo); public static void Click(int x, int y, uint down, uint up) { SetCursorPos(x, y); mouse_event(down, 0, 0, 0, 0); mouse_event(up, 0, 0, 0, 0); } }'; [Mouse]::Click(${x}, ${y}, ${buttonDown}, ${buttonUp})"`
			await execAsync(command)
			return {
				success: true,
				message: `Клик ${button} кнопкой мыши на координатах (${x}, ${y})`,
			}
		} catch (error) {
			console.error('Click error:', error)
			return { error: `Ошибка клика: ${error.message}` }
		}
	},
)
electron_1.ipcMain.handle(
	'system-mouse-down',
	async (event, x, y, button = 'left') => {
		try {
			if (process.platform === 'darwin') {
				if (button && button.toLowerCase() === 'right') {
					await runOsascript(
						`tell application "System Events" to click at {${x}, ${y}} with right click`,
					)
				} else {
					await runOsascript(
						`tell application "System Events" to click at {${x}, ${y}}`,
					)
				}
				return { success: true, message: `Клик на (${x}, ${y})` }
			}
			if (process.platform !== 'win32') {
				return { error: 'Только для Windows' }
			}
			const buttonCode = button.toLowerCase() === 'right' ? '0x0008' : '0x0002'
			const command = `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Mouse { [DllImport(\\\"user32.dll\\\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\\\"user32.dll\\\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo); }'; [Mouse]::SetCursorPos(${x}, ${y}); [Mouse]::mouse_event(${buttonCode}, 0, 0, 0, 0)"`
			await execAsync(command)
			return {
				success: true,
				message: `Зажата ${button} кнопка мыши на (${x}, ${y})`,
			}
		} catch (error) {
			console.error('Mouse down error:', error)
			return { error: `Ошибка зажатия кнопки: ${error.message}` }
		}
	},
)
electron_1.ipcMain.handle('system-mouse-up', async (event, button = 'left') => {
	try {
		if (process.platform === 'darwin') {
			return { success: true, message: 'Кнопка мыши отпущена' }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const buttonCode = button.toLowerCase() === 'right' ? '0x0010' : '0x0004'
		const command = `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Mouse { [DllImport(\\\"user32.dll\\\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo); }'; [Mouse]::mouse_event(${buttonCode}, 0, 0, 0, 0)"`
		await execAsync(command)
		return { success: true, message: `Отпущена ${button} кнопка мыши` }
	} catch (error) {
		console.error('Mouse up error:', error)
		return { error: `Ошибка отпускания кнопки: ${error.message}` }
	}
})
electron_1.ipcMain.handle('system-move-mouse', async (event, x, y) => {
	try {
		if (process.platform === 'darwin') {
			await runOsascript(
				`tell application "System Events" to click at {${x}, ${y}}`,
			)
			return {
				success: true,
				message: `Курсор перемещён и клик на (${x}, ${y})`,
			}
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const command = `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Mouse { [DllImport(\\\"user32.dll\\\")] public static extern bool SetCursorPos(int x, int y); }'; [Mouse]::SetCursorPos(${x}, ${y})"`
		await execAsync(command)
		return { success: true, message: `Курсор перемещен на (${x}, ${y})` }
	} catch (error) {
		console.error('Move mouse error:', error)
		return { error: `Ошибка перемещения курсора: ${error.message}` }
	}
})
electron_1.ipcMain.handle(
	'system-scroll',
	async (event, x, y, delta, direction = 'down') => {
		try {
			if (process.platform === 'darwin') {
				const times = Math.min(20, Math.max(1, Math.abs(delta || 1)))
				const keyCode = direction.toLowerCase() === 'up' ? 107 : 108
				for (let i = 0; i < times; i++) {
					await runOsascript(
						`tell application "System Events" to key code ${keyCode}`,
					)
				}
				return { success: true, message: `Прокрутка ${direction}` }
			}
			if (process.platform !== 'win32') {
				return { error: 'Только для Windows' }
			}
			const scrollDelta =
				direction.toLowerCase() === 'up' ? -Math.abs(delta) : Math.abs(delta)
			const command = `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Mouse { [DllImport(\\\"user32.dll\\\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\\\"user32.dll\\\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo); }'; [Mouse]::SetCursorPos(${x}, ${y}); [Mouse]::mouse_event(0x0800, 0, 0, ${scrollDelta * 120}, 0)"`
			await execAsync(command)
			return {
				success: true,
				message: `Прокрутка ${direction} на ${Math.abs(delta)} единиц на (${x}, ${y})`,
			}
		} catch (error) {
			console.error('Scroll error:', error)
			return { error: `Ошибка прокрутки: ${error.message}` }
		}
	},
)
electron_1.ipcMain.handle('system-double-click', async (event, x, y) => {
	try {
		if (process.platform === 'darwin') {
			await runOsascript(
				`tell application "System Events" to click at {${x}, ${y}}`,
			)
			await runOsascript('delay 0.05')
			await runOsascript(
				`tell application "System Events" to click at {${x}, ${y}}`,
			)
			return { success: true, message: `Двойной клик на (${x}, ${y})` }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const command = `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Mouse { [DllImport(\\\"user32.dll\\\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\\\"user32.dll\\\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo); }'; [Mouse]::SetCursorPos(${x}, ${y}); [Mouse]::mouse_event(0x0002, 0, 0, 0, 0); [Mouse]::mouse_event(0x0004, 0, 0, 0, 0); Start-Sleep -Milliseconds 50; [Mouse]::mouse_event(0x0002, 0, 0, 0, 0); [Mouse]::mouse_event(0x0004, 0, 0, 0, 0)"`
		await execAsync(command)
		return { success: true, message: `Двойной клик на (${x}, ${y})` }
	} catch (error) {
		console.error('Double click error:', error)
		return { error: `Ошибка двойного клика: ${error.message}` }
	}
})
electron_1.ipcMain.handle('system-get-screen-size', async () => {
	try {
		if (process.platform === 'darwin') {
			const primary = electron_1.screen.getPrimaryDisplay()
			const bounds = primary.size || primary.bounds
			return { success: true, width: bounds.width, height: bounds.height }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const command = `powershell -Command "[System.Windows.Forms.Screen]::PrimaryScreen.Bounds"`
		const { stdout } = await execAsync(command)
		// Парсим размер экрана из вывода PowerShell
		const widthMatch = stdout.match(/Width\s*:\s*(\d+)/)
		const heightMatch = stdout.match(/Height\s*:\s*(\d+)/)
		if (widthMatch && heightMatch) {
			return {
				success: true,
				width: parseInt(widthMatch[1]),
				height: parseInt(heightMatch[1]),
			}
		}
		// Альтернативный способ
		const altCommand = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds"`
		const { stdout: altStdout } = await execAsync(altCommand)
		return { success: true, output: altStdout }
	} catch (error) {
		console.error('Get screen size error:', error)
		return { error: `Ошибка получения размера экрана: ${error.message}` }
	}
})
// Browser Control handlers
electron_1.ipcMain.handle('browser-open-url', async (event, url, browser) => {
	try {
		if (process.platform === 'darwin') {
			return await openExternalUrl(url)
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const browserMap = {
			chrome: 'chrome',
			edge: 'msedge',
			firefox: 'firefox',
			opera: 'opera',
			yandex: 'browser',
			brave: 'brave',
		}
		const browserName = browser
			? browserMap[browser.toLowerCase()] || browser
			: null
		// Если браузер не указан — используем самый надежный способ
		if (!browserName) {
			return await openExternalUrl(url)
		}
		// Если указан — пытаемся через Start-Process, а при ошибке падаем обратно на openExternal
		const command = `powershell -Command "Start-Process '${browserName}' -ArgumentList '${url.replace(/'/g, "''")}'"`
		await execAsync(command)
		return { success: true, message: `URL "${url}" открыт в ${browser}` }
	} catch (error) {
		console.error('Browser open URL error:', error)
		// Фоллбек
		return await openExternalUrl(url)
	}
})
electron_1.ipcMain.handle('browser-search', async (event, query, browser) => {
	try {
		if (process.platform === 'darwin') {
			const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`
			return await openExternalUrl(searchUrl)
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`
		const browserMap = {
			chrome: 'chrome',
			edge: 'msedge',
			firefox: 'firefox',
			opera: 'opera',
			yandex: 'browser',
			brave: 'brave',
		}
		const browserName = browser
			? browserMap[browser.toLowerCase()] || browser
			: null
		if (!browserName) {
			const r = await openExternalUrl(searchUrl)
			return r.success
				? { success: true, message: `Поиск "${query}" открыт` }
				: r
		}
		const command = `powershell -Command "Start-Process '${browserName}' -ArgumentList '${searchUrl.replace(/'/g, "''")}'"`
		await execAsync(command)
		return { success: true, message: `Поиск "${query}" открыт в ${browser}` }
	} catch (error) {
		console.error('Browser search error:', error)
		return await openExternalUrl(
			`https://www.google.com/search?q=${encodeURIComponent(query)}`,
		)
	}
})
electron_1.ipcMain.handle('browser-new-tab', async (event, url, browser) => {
	try {
		if (process.platform === 'darwin') {
			const targetUrl = url || 'https://'
			return await openExternalUrl(targetUrl)
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const targetUrl = url || 'about:blank'
		const browserMap = {
			chrome: 'chrome',
			edge: 'msedge',
			firefox: 'firefox',
			opera: 'opera',
			yandex: 'browser',
			brave: 'brave',
		}
		const browserName = browser
			? browserMap[browser.toLowerCase()] || browser
			: null
		if (!browserName) {
			return await openExternalUrl(targetUrl)
		}
		const command = `powershell -Command "Start-Process '${browserName}' -ArgumentList '${targetUrl.replace(/'/g, "''")}'"`
		await execAsync(command)
		return {
			success: true,
			message: `Новая вкладка открыта${url ? ` с ${url}` : ''} в ${browser}`,
		}
	} catch (error) {
		console.error('Browser new tab error:', error)
		return await openExternalUrl(url || 'about:blank')
	}
})
electron_1.ipcMain.handle('browser-close-tab', async (event, browser) => {
	try {
		if (process.platform === 'darwin') {
			await runOsascript(
				'tell application "System Events" to keystroke "w" using command down',
			)
			return { success: true, message: 'Вкладка закрыта' }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const command = `powershell -Command "[System.Windows.Forms.SendKeys]::SendWait('^w')"`
		await execAsync(command)
		return {
			success: true,
			message: `Вкладка закрыта${browser ? ` в ${browser}` : ''}`,
		}
	} catch (error) {
		console.error('Browser close tab error:', error)
		return { error: `Не удалось закрыть вкладку: ${error.message}` }
	}
})
electron_1.ipcMain.handle('browser-refresh', async (event, browser) => {
	try {
		if (process.platform === 'darwin') {
			await runOsascript(
				'tell application "System Events" to keystroke "r" using command down',
			)
			return { success: true, message: 'Страница обновлена' }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const command = `powershell -Command "[System.Windows.Forms.SendKeys]::SendWait('{F5}')"`
		await execAsync(command)
		return {
			success: true,
			message: `Страница обновлена${browser ? ` в ${browser}` : ''}`,
		}
	} catch (error) {
		console.error('Browser refresh error:', error)
		return { error: `Не удалось обновить страницу: ${error.message}` }
	}
})
electron_1.ipcMain.handle('browser-go-back', async (event, browser) => {
	try {
		if (process.platform === 'darwin') {
			await runOsascript(
				'tell application "System Events" to keystroke "[" using command down',
			)
			return { success: true, message: 'Навигация назад' }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const command = `powershell -Command "[System.Windows.Forms.SendKeys]::SendWait('%{LEFT}')"`
		await execAsync(command)
		return {
			success: true,
			message: `Навигация назад${browser ? ` в ${browser}` : ''}`,
		}
	} catch (error) {
		console.error('Browser go back error:', error)
		return { error: `Не удалось вернуться назад: ${error.message}` }
	}
})
electron_1.ipcMain.handle('browser-go-forward', async (event, browser) => {
	try {
		if (process.platform === 'darwin') {
			await runOsascript(
				'tell application "System Events" to keystroke "]" using command down',
			)
			return { success: true, message: 'Навигация вперед' }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const command = `powershell -Command "[System.Windows.Forms.SendKeys]::SendWait('%{RIGHT}')"`
		await execAsync(command)
		return {
			success: true,
			message: `Навигация вперед${browser ? ` в ${browser}` : ''}`,
		}
	} catch (error) {
		console.error('Browser go forward error:', error)
		return { error: `Не удалось перейти вперед: ${error.message}` }
	}
})
electron_1.ipcMain.handle('browser-get-url', async (event, browser) => {
	try {
		if (process.platform === 'darwin') {
			await runOsascript(
				'tell application "System Events" to keystroke "l" using command down',
			)
			await new Promise(r => setTimeout(r, 150))
			await runOsascript(
				'tell application "System Events" to keystroke "c" using command down',
			)
			await new Promise(r => setTimeout(r, 50))
			const { stdout } = await execAsync("osascript -e 'the clipboard'")
			const url = (stdout || '').trim()
			return { success: true, url: url || 'URL скопирован в буфер обмена' }
		}
		if (process.platform !== 'win32') {
			return { error: 'Только для Windows' }
		}
		const command = `powershell -Command "[System.Windows.Forms.SendKeys]::SendWait('^l'); Start-Sleep -Milliseconds 100; [System.Windows.Forms.SendKeys]::SendWait('^c')"`
		await execAsync(command)
		return { success: true, url: 'URL скопирован в буфер обмена' }
	} catch (error) {
		console.error('Browser get URL error:', error)
		return { error: `Не удалось получить URL: ${error.message}` }
	}
})

// IPC обработчик: получить информацию о текущем пользователе
electron_1.ipcMain.handle('get-current-user-info', async () => {
	try {
		if (mainWindow && !mainWindow.isDestroyed()) {
			const result = await mainWindow.webContents.executeJavaScript(`
                (function() {
                    var tid = null;
                    try { if (typeof CREATOR_TELEGRAM_ID !== 'undefined' && CREATOR_TELEGRAM_ID) tid = String(CREATOR_TELEGRAM_ID); } catch (e) {}
                    var uname = null;
                    try { if (typeof profile !== 'undefined' && profile && profile.name) uname = profile.name; } catch (e) {}
                    if (!uname) { try { uname = JSON.parse(localStorage.getItem('profile') || '{}').name || null; } catch (e2) {} }
                    const role = typeof getCurrentUserRole === 'function' ? getCurrentUserRole() : 'user';
                    return { telegramId: tid, username: uname, role: role || 'user' };
                })();
            `)
			return { success: true, ...result }
		}
		return { success: false, error: 'Главное окно не найдено' }
	} catch (error) {
		console.error('Ошибка получения информации о пользователе:', error)
		return { success: false, error: error.message }
	}
})

// Telegram (MTProto / GramJS): см. dist/telegram-user-bridge.cjs — обработчики должны регистрироваться всегда (ленивый require GramJS внутри моста).
try {
	const { registerTelegramUserHandlers } = require(
		path.join(__dirname, 'telegram-user-bridge.cjs'),
	)
	registerTelegramUserHandlers(electron_1.ipcMain, () =>
		electron_1.app.getPath('userData'),
	)
	console.log('[nexa] Telegram user IPC registered')
} catch (e) {
	console.error('[nexa] Telegram user IPC registration failed:', e)
}
