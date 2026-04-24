'use strict'
/**
 * Telegram от имени пользователя (MTProto через GramJS, npm-пакет `telegram`).
 * Ленивая загрузка GramJS: иначе при ошибке require IPC-обработчики не регистрируются → "No handler registered".
 * Сессия: userData/telegram-user-mtproto.json
 *
 * Примечание: Telethon — это Python; в Electron здесь используется эквивалентный клиент GramJS.
 */
const fs = require('fs')
const path = require('path')

/** @type {{ bigInt: any, TelegramClient: any, StringSession: any, Api: any, auth: any } | null} */
let _gram = null

function loadGram() {
	if (_gram) return _gram
	const bigInt = require('big-integer')
	const { TelegramClient } = require('telegram')
	const { StringSession } = require('telegram/sessions')
	const { Api } = require('telegram/tl')
	const auth = require('telegram/client/auth')
	_gram = { bigInt, TelegramClient, StringSession, Api, auth }
	return _gram
}

function dataFile(userData) {
	return path.join(userData, 'telegram-user-mtproto.json')
}

function loadStore(userData) {
	try {
		const p = dataFile(userData)
		if (!fs.existsSync(p)) return null
		return JSON.parse(fs.readFileSync(p, 'utf8'))
	} catch (e) {
		return null
	}
}

function saveStore(userData, obj) {
	const p = dataFile(userData)
	fs.mkdirSync(path.dirname(p), { recursive: true })
	fs.writeFileSync(p, JSON.stringify(obj, null, 0), 'utf8')
}

function clearStore(userData) {
	try {
		fs.unlinkSync(dataFile(userData))
	} catch (e) {
		/* ignore */
	}
}

async function safeDisconnect(client) {
	try {
		if (client && client.connected) await client.disconnect()
	} catch (e) {
		/* ignore */
	}
}

const STATE = {
	pendingAuth: null,
	idleClient: null,
	lastRecipientHint: null,
}

function norm(s) {
	return String(s || '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/\u0301/g, '')
		.replace(/ё/g, 'е')
		.trim()
}

function formatGramError(e) {
	if (!e) return 'Неизвестная ошибка'
	const msg = e.message || ''
	const em = e.errorMessage || ''
	if (/GRAMJS_LOAD|Cannot find module/i.test(msg)) {
		return 'Не удалось загрузить модуль Telegram. В папке приложения выполни: npm install telegram smart-buffer'
	}
	if (
		em === 'SESSION_PASSWORD_NEEDED' ||
		msg.includes('SESSION_PASSWORD_NEEDED')
	) {
		return 'Нужен пароль двухэтапной аутентификации Telegram.'
	}
	if (em === 'PHONE_CODE_INVALID' || msg.includes('PHONE_CODE_INVALID')) {
		return 'Неверный код. Запроси код заново.'
	}
	if (em === 'PHONE_CODE_EXPIRED' || msg.includes('PHONE_CODE_EXPIRED')) {
		return 'Код истёк. Нажми «Отправить код в Telegram» снова.'
	}
	if (em === 'FLOOD_WAIT' || /FLOOD|FloodWait|FLOOD_WAIT/i.test(msg + em)) {
		const sec =
			e.seconds != null ? e.seconds : (String(msg).match(/(\d+)/) || [])[1]
		return (
			'Telegram ограничил частоту запросов. Подожди ' +
			(sec ? sec + ' с.' : 'немного') +
			' и повтори.'
		)
	}
	if (
		em === 'USER_NOT_PARTICIPANT' ||
		/not found|Could not find|USERNAME_NOT_OCCUPIED/i.test(msg + em)
	) {
		return 'Получатель не найден. Проверь @username, телефон или синоним в настройках.'
	}
	return msg || em || String(e)
}

function contactScore(target, u) {
	const t = norm(target)
	if (!t) return 0
	const fn = norm(u.firstName || '')
	const ln = norm(u.lastName || '')
	const un = norm(u.username || '')
	const parts = [fn, ln, un].filter(Boolean)
	for (const p of parts) {
		if (p === t) return 100
		if (p.includes(t) || t.includes(p)) return 85
	}
	const stem = t.replace(/(ам|ем|им|ом|ах|ях|ю|у|е|и|ой|ый|ая|ое)$/i, '')
	if (stem.length >= 2) {
		for (const p of parts) {
			if (
				p.startsWith(stem) ||
				stem.startsWith(p.slice(0, Math.min(p.length, stem.length + 1)))
			)
				return 72
		}
	}
	return 0
}

async function resolveRecipient(client, hint, nickMap) {
	const { Api, bigInt } = loadGram()
	const h = String(hint || '').trim()
	if (!h) throw new Error('Не указан получатель')

	const n = norm(h)
	if (n === 'me' || n === 'я' || n === 'себе' || n === 'себя') {
		const me = await client.getMe()
		return client.getEntity(me)
	}

	const aliases = nickMap && typeof nickMap === 'object' ? nickMap : {}
	const direct = aliases[h] || aliases[n]
	if (direct) {
		const v = String(direct).trim()
		const vn = norm(v)
		if (vn === 'me' || vn === 'я') {
			const me = await client.getMe()
			return client.getEntity(me)
		}
		if (/^-?\d+$/.test(v)) return client.getEntity(bigInt(v))
		if (v.startsWith('@') || /^\+/.test(v)) return client.getEntity(v)
		return client.getEntity('@' + v.replace(/^@/, ''))
	}

	if (h.startsWith('@')) return client.getEntity(h)
	const digits = h.replace(/\D/g, '')
	if (digits.length >= 10 && /^\+?\d[\d\s\-]+$/.test(h.replace(/\s/g, ''))) {
		return client.getEntity('+' + digits)
	}

	const res = await client.invoke(
		new Api.contacts.GetContacts({ hash: bigInt.zero }),
	)
	if (!(res instanceof Api.contacts.Contacts)) {
		throw new Error('Список контактов недоступен.')
	}
	let best = null
	let bestScore = 0
	for (const u of res.users) {
		if (!u || u.className !== 'User' || u.bot) continue
		const sc = contactScore(h, u)
		if (sc > bestScore) {
			bestScore = sc
			best = u
		}
	}
	if (best && bestScore >= 70) return client.getEntity(best)

	try {
		return await client.getEntity(h)
	} catch (e) {
		throw new Error(
			'Не удалось найти получателя «' +
				h +
				'». Укажи @username, телефон, me/я или синоним в настройках.',
		)
	}
}

function makeClientFromStore(userData) {
	const { StringSession, TelegramClient } = loadGram()
	const data = loadStore(userData)
	if (!data || !data.sessionString)
		return {
			error:
				'Нет сохранённой сессии. Войди в Настройках (my.telegram.org → api_id / api_hash).',
		}
	const apiId = Number(data.apiId)
	const apiHash = String(data.apiHash || '')
	if (!apiId || !apiHash)
		return { error: 'В данных сессии нет api_id или api_hash.' }
	const session = new StringSession(data.sessionString)
	const client = new TelegramClient(session, apiId, apiHash, {
		connectionRetries: 5,
	})
	return { client, data }
}

async function getAuthorizedClient(userData) {
	loadGram()
	if (STATE.idleClient) {
		try {
			if (!STATE.idleClient.connected) await STATE.idleClient.connect()
			const ok = await STATE.idleClient.checkAuthorization()
			if (ok) return { client: STATE.idleClient }
		} catch (e) {
			await safeDisconnect(STATE.idleClient)
			STATE.idleClient = null
		}
	}
	const made = makeClientFromStore(userData)
	if (made.error) return { error: made.error }
	await made.client.connect()
	const ok = await made.client.checkAuthorization()
	if (!ok) {
		await safeDisconnect(made.client)
		return { error: 'Сессия недействительна. Войди снова.' }
	}
	STATE.idleClient = made.client
	return { client: made.client }
}

function registerTelegramUserHandlers(ipcMain, getUserDataPath) {
	const userData = () => getUserDataPath()

	ipcMain.handle('telegram-user-status', async () => {
		try {
			loadGram()
		} catch (e) {
			return { ok: false, authorized: false, error: formatGramError(e) }
		}
		try {
			const st = loadStore(userData())
			if (!st || !st.sessionString) return { ok: true, authorized: false }
			const made = makeClientFromStore(userData())
			if (made.error) return { ok: true, authorized: false, error: made.error }
			const c = made.client
			await c.connect()
			const ok = await c.checkAuthorization()
			if (!ok) {
				await safeDisconnect(c)
				return { ok: true, authorized: false, error: 'Сессия недействительна' }
			}
			const me = await c.getMe()
			await safeDisconnect(c)
			return {
				ok: true,
				authorized: true,
				self: {
					id: me.id != null ? String(me.id) : '',
					firstName: me.firstName || '',
					username: me.username || '',
				},
			}
		} catch (e) {
			return { ok: false, authorized: false, error: formatGramError(e) }
		}
	})

	ipcMain.handle(
		'telegram-user-login-start',
		async (_e, { apiId, apiHash, phone }) => {
			try {
				const { TelegramClient, StringSession, auth } = loadGram()
				if (STATE.pendingAuth) {
					await safeDisconnect(STATE.pendingAuth.client)
					STATE.pendingAuth = null
				}
				const apiIdN = Number(apiId)
				const apiHashS = String(apiHash || '').trim()
				const phoneS = String(phone || '').trim()
				if (!apiIdN || !apiHashS || !phoneS) {
					return {
						ok: false,
						error: 'Укажи api_id, api_hash и номер (+код страны).',
					}
				}
				const session = new StringSession('')
				const client = new TelegramClient(session, apiIdN, apiHashS, {
					connectionRetries: 5,
				})
				await client.connect()
				if (await client.checkAuthorization()) {
					const sessionString = client.session.save()
					saveStore(userData(), {
						apiId: apiIdN,
						apiHash: apiHashS,
						sessionString,
					})
					await safeDisconnect(client)
					STATE.idleClient = null
					return { ok: true, alreadyAuthorized: true }
				}
				const cred = { apiId: apiIdN, apiHash: apiHashS }
				const sent = await auth.sendCode(client, cred, phoneS, false)
				STATE.pendingAuth = {
					client,
					phone: phoneS,
					phoneCodeHash: sent.phoneCodeHash,
					apiId: apiIdN,
					apiHash: apiHashS,
					needsPassword: false,
				}
				return { ok: true, needsCode: true, isCodeViaApp: !!sent.isCodeViaApp }
			} catch (e) {
				return { ok: false, error: formatGramError(e) }
			}
		},
	)

	ipcMain.handle('telegram-user-login-code', async (_e, { code }) => {
		try {
			const { Api } = loadGram()
			const p = STATE.pendingAuth
			if (!p)
				return { ok: false, error: 'Сначала нажми «Отправить код в Telegram».' }
			const c = p.client
			const cred = { apiId: p.apiId, apiHash: p.apiHash }
			try {
				const result = await c.invoke(
					new Api.auth.SignIn({
						phoneNumber: p.phone,
						phoneCodeHash: p.phoneCodeHash,
						phoneCode: String(code || '').trim(),
					}),
				)
				if (result instanceof Api.auth.AuthorizationSignUpRequired) {
					return {
						ok: false,
						error:
							'Номер не зарегистрирован в Telegram — создай аккаунт в официальном клиенте.',
					}
				}
				const sessionString = c.session.save()
				saveStore(userData(), {
					apiId: p.apiId,
					apiHash: p.apiHash,
					sessionString,
				})
				await safeDisconnect(c)
				STATE.pendingAuth = null
				STATE.idleClient = null
				return { ok: true }
			} catch (err) {
				if (err && err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
					p.needsPassword = true
					return { ok: false, needsPassword: true, error: 'Введи пароль 2FA.' }
				}
				return { ok: false, error: formatGramError(err) }
			}
		} catch (e) {
			return { ok: false, error: formatGramError(e) }
		}
	})

	ipcMain.handle('telegram-user-login-password', async (_e, { password }) => {
		try {
			const { auth } = loadGram()
			const p = STATE.pendingAuth
			if (!p || !p.needsPassword)
				return { ok: false, error: 'Пароль 2FA сейчас не ожидается.' }
			const c = p.client
			const cred = { apiId: p.apiId, apiHash: p.apiHash }
			await auth.signInWithPassword(c, cred, {
				password: async () => String(password || ''),
				onError: async () => false,
			})
			const sessionString = c.session.save()
			saveStore(userData(), {
				apiId: p.apiId,
				apiHash: p.apiHash,
				sessionString,
			})
			await safeDisconnect(c)
			STATE.pendingAuth = null
			STATE.idleClient = null
			return { ok: true }
		} catch (e) {
			return { ok: false, error: formatGramError(e) }
		}
	})

	ipcMain.handle('telegram-user-logout', async () => {
		try {
			loadGram()
			if (STATE.pendingAuth) {
				await safeDisconnect(STATE.pendingAuth.client)
				STATE.pendingAuth = null
			}
			await safeDisconnect(STATE.idleClient)
			STATE.idleClient = null
			clearStore(userData())
			STATE.lastRecipientHint = null
			return { ok: true }
		} catch (e) {
			return { ok: false, error: formatGramError(e) }
		}
	})

	ipcMain.handle(
		'telegram-user-send',
		async (_e, { recipient, text, nickMap }) => {
			try {
				const { sendMessage } = require('telegram/client/messages')
				const body = String(text || '').trim()
				if (!body) return { ok: false, error: 'Пустой текст сообщения.' }
				const got = await getAuthorizedClient(userData())
				if (got.error) return { ok: false, error: got.error }
				const client = got.client
				const entity = await resolveRecipient(client, recipient, nickMap)
				await sendMessage(client, entity, { message: body.slice(0, 4096) })
				STATE.lastRecipientHint = String(recipient || '').trim()
				return { ok: true }
			} catch (e) {
				return { ok: false, error: formatGramError(e) }
			}
		},
	)

	ipcMain.handle('telegram-user-reply-last', async (_e, { text, nickMap }) => {
		try {
			const { sendMessage, getMessages } = require('telegram/client/messages')
			const body = String(text || '').trim()
			if (!body) return { ok: false, error: 'Пустой текст ответа.' }
			if (!STATE.lastRecipientHint) {
				return { ok: false, error: 'Нет активного чата. Сначала «напиши …».' }
			}
			const got = await getAuthorizedClient(userData())
			if (got.error) return { ok: false, error: got.error }
			const client = got.client
			const entity = await resolveRecipient(
				client,
				STATE.lastRecipientHint,
				nickMap,
			)
			const hist = await getMessages(client, entity, { limit: 1 })
			const replyTo =
				hist && hist.length && hist[0].id != null ? hist[0].id : undefined
			await sendMessage(client, entity, {
				message: body.slice(0, 4096),
				replyTo,
			})
			return { ok: true }
		} catch (e) {
			return { ok: false, error: formatGramError(e) }
		}
	})

	ipcMain.handle('telegram-user-read-last', async (_e, { nickMap, limit }) => {
		try {
			const { getMessages } = require('telegram/client/messages')
			const lim = Math.min(20, Math.max(1, Number(limit) || 5))
			const got = await getAuthorizedClient(userData())
			if (got.error) return { ok: false, error: got.error }
			const client = got.client
			if (!STATE.lastRecipientHint) {
				return {
					ok: false,
					error: 'Сначала отправь сообщение в нужный контакт («напиши …»).',
				}
			}
			const entity = await resolveRecipient(
				client,
				STATE.lastRecipientHint,
				nickMap,
			)
			const msgs = await getMessages(client, entity, { limit: lim })
			const lines = []
			for (const m of msgs || []) {
				if (!m || !m.message) continue
				const who = m.senderId ? String(m.senderId) : '?'
				lines.push(
					'— ' +
						who +
						': ' +
						String(m.message).replace(/\s+/g, ' ').slice(0, 200),
				)
			}
			return {
				ok: true,
				text: lines.length ? lines.reverse().join('\n') : '(пусто)',
			}
		} catch (e) {
			return { ok: false, error: formatGramError(e) }
		}
	})
}

module.exports = { registerTelegramUserHandlers }
