import fs from 'fs';
import nodePath from 'path';
import _digestFetch from 'digest-fetch';
import { Agent } from 'undici';
import { BaseSkill } from '../base.js';
import { STATE_PATH } from '../../core/config.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const DigestFetch = _digestFetch.default || _digestFetch

const EVENTS_LOG_PATH = nodePath.join(STATE_PATH, 'dahua-events.jsonl') // written by src/core/dahua-notifier.js

// Vision/text model for AI summaries — Gemini primary, Claude fallback (same "auto-fallback on
// quota/failure" idea as src/core/llm/LLMCoordinator.js, kept self-contained here since this
// skill has no access to AICoordinator's internal instance).
const GEMINI_MODEL = 'gemini-2.0-flash'
const CLAUDE_MODEL = 'claude-sonnet-5'

// Some Dahua devices (e.g. shop1) force-redirect plain HTTP to HTTPS with a self-signed
// cert (typical for a local camera admin UI). fetch() follows that redirect automatically
// but rejects the cert by default — this lets it through, same trust model as a browser
// "proceed anyway" on a device the user already owns and provided credentials for.
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } })

// Robustness constants — same shape as src/core/mikrotik.js's connection handling
// (exponential reconnect backoff capped at 5min, 10s request timeout) applied to
// Dahua's stateless per-call HTTP model via a per-device circuit breaker instead
// of a persistent connection.
const DEFAULT_TIMEOUT = 10_000
const RECONNECT_INTERVAL = 5_000
const MAX_RECONNECT_DELAY = 300_000
const CIRCUIT_FAILURE_THRESHOLD = 5

class DahuaSkill extends BaseSkill {
  static id = 'dahua'
  static name = 'Dahua CCTV'
  static description = 'Control Dahua cameras/NVRs: PTZ, snapshots, events, device mgmt'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.clients = new Map() // deviceId -> DigestFetch client
    this.state = new Map() // deviceId -> { isConnected, lastError, lastConnectedAt, consecutiveFailures, circuitOpenUntil }
  }

  /** Per-device connection state, mikrotik.js-style (isConnected/lastError/lastConnectedAt), lazily created. */
  _deviceState(deviceId) {
    if (!this.state.has(deviceId)) {
      this.state.set(deviceId, {
        isConnected: null,
        lastError: null,
        lastConnectedAt: null,
        consecutiveFailures: 0,
        circuitOpenUntil: 0
      })
    }
    return this.state.get(deviceId)
  }

  static getTools() {
    return {
      'dahua.device.list': {
        risk: 'low',
        description: 'List all available Dahua devices in the workspace',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      'dahua.device.info': {
        risk: 'low',
        description: 'Get device info: model, firmware, serial',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'deviceId from workspace (optional, defaults to first)' }
          },
          required: []
        }
      },
      'dahua.snapshot.get': {
        risk: 'low',
        description: 'Get JPEG snapshot from camera channel',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            channel: { type: 'number', default: 1, description: 'channel for NVRs' }
          },
          required: []
        }
      },
      'dahua.snapshot.getAll': {
        risk: 'low',
        description: 'Get a JPEG snapshot from every channel on an NVR',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' }
          },
          required: []
        }
      },
      'dahua.device.channels': {
        risk: 'low',
        description: 'List camera channels configured on a device/NVR (index + name)',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' }
          },
          required: []
        }
      },
      'dahua.stream.url': {
        risk: 'low',
        description: 'Get live RTSP stream URL(s) for a channel (main + sub stream)',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            channel: { type: 'number', default: 1, description: 'channel for NVRs' }
          },
          required: []
        }
      },
      'dahua.ptz.move': {
        risk: 'medium',
        description: 'PTZ move: Up, Down, Left, Right, ZoomIn, ZoomOut. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            channel: { type: 'number', default: 1 },
            action: { type: 'string', enum: ['Up', 'Down', 'Left', 'Right', 'LeftUp', 'LeftDown', 'RightUp', 'RightDown', 'ZoomWide', 'ZoomTele', 'Stop'] },
            speed: { type: 'number', minimum: 1, maximum: 8, default: 4 },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['action', 'reason']
        }
      },
      'dahua.ptz.preset': {
        risk: 'medium',
        description: 'Go to PTZ preset. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            channel: { type: 'number', default: 1 },
            preset: { type: 'number', minimum: 1, maximum: 255 },
            reason: { type: 'string' }
          },
          required: ['preset', 'reason']
        }
      },
      'dahua.events.subscribe': {
        risk: 'low',
        description: 'Query the historical alarm log (logins, video loss, tampering, IP conflicts, etc). NOTE: motion/IVS events are usually not retained here — use live notifications for those.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            codes: { type: 'array', items: { type: 'string' }, description: 'Filter to these .Type values (e.g. "Illegal Login", "Video Loss"). Omit for all Alarm-category events.' },
            minutes: { type: 'number', default: 60, maximum: 1440 }
          },
          required: []
        }
      },
      'dahua.system.reboot': {
        risk: 'high',
        description: 'Reboot Dahua device. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['reason']
        }
      },
      'dahua.scene.describe': {
        risk: 'low',
        description: 'AI vision summary of what\'s happening RIGHT NOW on a channel (people, movement, anything notable) — takes a live snapshot and describes it.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string', description: 'Optional device ID' },
            channel: { type: 'number', default: 1 }
          },
          required: []
        }
      },
      'dahua.events.summarize': {
        risk: 'low',
        description: 'Same time/keyword parsing as dahua.events.search, but returns a short AI-written plain-English summary instead of a raw event list — for "what happened last night" style questions.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'e.g. "what happened at the front door last night"' },
            device: { type: 'string', description: 'Optional: limit to one device' },
            minutes: { type: 'number', description: 'Optional explicit lookback window' }
          },
          required: ['query']
        }
      },
      'dahua.events.search': {
        risk: 'low',
        description: 'Free-text search across recent motion (from live notifications, since Dahua does not retain motion history itself) and the device\'s historical log (logins, tamper, video loss, IP conflicts). Understands "yesterday", "last night", "this morning", "last N hours/minutes", channel names, and keywords like "motion"/"login"/"reboot" — no AI/LLM required.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'e.g. "did anyone come to the front door last night"' },
            device: { type: 'string', description: 'Optional: limit to one device' },
            minutes: { type: 'number', description: 'Optional explicit lookback window, overrides any time phrase parsed from query' }
          },
          required: ['query']
        }
      },
      'dahua.device.discover': {
        risk: 'low',
        description: 'Scan a /24 subnet for Dahua/OEM devices via an unauthenticated HTTP digest-challenge fingerprint — finds cameras before they are configured, no credentials required to discover (only to add/control).',
        parameters: {
          type: 'object',
          properties: {
            cidr: { type: 'string', description: 'e.g. "192.168.1.0/24" — defaults to the /24 of the first configured device' },
            port: { type: 'number', default: 80 },
            timeoutMs: { type: 'number', default: 800 },
            concurrency: { type: 'number', default: 32 }
          },
          required: []
        }
      }
    }
  }

  async _client(deviceId) {
    const targetDevice = deviceId || Object.keys(this.workspace.dahua_devices || {})[0]
    if (!targetDevice) {
      throw new Error('No Dahua devices configured in workspace')
    }

    if (this.clients.has(targetDevice)) return this.clients.get(targetDevice)

    const dev = this.workspace.dahua_devices && this.workspace.dahua_devices[targetDevice]
    const supported = ['dahua', 'amcrest', 'lorex', 'qsee', 'icrealtime']
    if (!dev || !supported.includes((dev.driver || '').toLowerCase())) {
        throw new Error(`Dahua/OEM device ${targetDevice} not found or unsupported driver`)
    }

    const base = await this._resolveBase(dev)
    const client = new DigestFetch(dev.user, dev.password)
    this.clients.set(targetDevice, { client, base, deviceId: targetDevice })
    return this.clients.get(targetDevice)
  }

  /**
   * Some Dahua devices force-redirect plain HTTP to HTTPS (self-signed cert) at the
   * device network config level (e.g. shop1). Following that redirect mid-digest-handshake
   * breaks the digest response hash (it includes the request URI, which changes on redirect),
   * so this probes once — unauthenticated, redirect: 'manual' — and picks the real scheme/port
   * up front instead of letting fetch silently redirect during an authenticated request.
   * Confirmed against live devices: shop2 (plain HTTP, 401 direct) vs shop1 (302 -> https:443).
   */
  async _resolveBase(dev) {
    const port = dev.port || 80
    try {
      const res = await fetch(`http://${dev.host}:${port}/cgi-bin/magicBox.cgi?action=getMachineName`, {
        redirect: 'manual',
        dispatcher: insecureDispatcher,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
      })
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (location && location.startsWith('https:')) {
        const url = new URL(location)
        return `https://${dev.host}:${url.port || 443}/cgi-bin`
      }
    } catch (_) {
      // Probe failed (device down, odd firmware) — fall through to the plain-HTTP default
      // and let the real call surface a clear error instead of masking it here.
    }
    return `http://${dev.host}:${port}/cgi-bin`
  }

  /**
   * All device HTTP calls funnel through here. Adds a request timeout (Dahua devices can
   * silently drop connections, e.g. mid-reboot) and a per-device circuit breaker: after
   * CIRCUIT_FAILURE_THRESHOLD consecutive failures it fails fast for an exponentially
   * growing cooldown (capped at MAX_RECONNECT_DELAY) instead of hammering an unreachable
   * device with slow, doomed requests — same intent as mikrotik.js's reconnect backoff,
   * adapted to Dahua's one-shot HTTP calls instead of a persistent RouterOS connection.
   */
  async _get(deviceId, path, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
    const { client, base, deviceId: resolvedId } = await this._client(deviceId)
    const st = this._deviceState(resolvedId)

    if (st.circuitOpenUntil > Date.now()) {
      const waitSec = Math.ceil((st.circuitOpenUntil - Date.now()) / 1000)
      throw new Error(`Dahua device ${resolvedId} unreachable (${st.consecutiveFailures} recent failures) — circuit open, retrying in ${waitSec}s`)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await client.fetch(`${base}/${path}`, { signal: controller.signal, dispatcher: insecureDispatcher })
      if (!res.ok) throw new Error(`Dahua API ${res.status} on device ${resolvedId}: ${await res.text()}`)
      st.isConnected = true
      st.lastConnectedAt = Date.now()
      st.consecutiveFailures = 0
      st.circuitOpenUntil = 0
      st.lastError = null
      return res
    } catch (e) {
      const err = e.name === 'AbortError' ? new Error(`Dahua device ${resolvedId} timed out after ${timeoutMs}ms`) : e
      st.isConnected = false
      st.lastError = err.message
      st.consecutiveFailures++
      if (st.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
        const delay = Math.min(RECONNECT_INTERVAL * Math.pow(2, st.consecutiveFailures - CIRCUIT_FAILURE_THRESHOLD), MAX_RECONNECT_DELAY)
        st.circuitOpenUntil = Date.now() + delay
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Unauthenticated subnet probe for Dahua/OEM devices — mirrors the *intent* of
   * src/core/discovery.js (find devices on the LAN) but not its mechanism: MikroTik's
   * discovery asks an already-connected router for its DHCP/ARP tables, but there's no
   * router-equivalent for cameras, so this does a real probe. Fingerprint: Dahua's
   * cgi-bin challenges unauthenticated requests with an HTTP 401 + WWW-Authenticate:
   * Digest realm="..." — that challenge is returned before any credentials are needed,
   * so devices can be found even before they're configured in workspace.dahua_devices.
   */
  async _discoverDevices({ cidr, port = 80, timeoutMs = 800, concurrency = 32 } = {}) {
    const base = cidr || this._defaultCidr()
    const hosts = this._hostsInCidr(base)
    if (!hosts.length) throw new Error(`No hosts to scan for CIDR ${base}`)

    const results = []
    for (let i = 0; i < hosts.length; i += concurrency) {
      const batch = hosts.slice(i, i + concurrency)
      const batchResults = await Promise.all(batch.map(host => this._probeHost(host, port, timeoutMs)))
      results.push(...batchResults.filter(Boolean))
    }
    return { cidr: base, scanned: hosts.length, found: results }
  }

  async _probeHost(host, port, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`http://${host}:${port}/cgi-bin/magicBox.cgi?action=getMachineName`, { signal: controller.signal, dispatcher: insecureDispatcher })
      const authHeader = res.headers.get('www-authenticate') || ''
      const likelyDahua = res.status === 401 && /digest/i.test(authHeader)
      if (!likelyDahua) return null
      const realm = (authHeader.match(/realm="([^"]*)"/) || [])[1] || null
      return { host, port, likelyDahua: true, realm }
    } catch (_) {
      return null // unreachable/timeout/non-HTTP — not a candidate, not an error
    } finally {
      clearTimeout(timer)
    }
  }

  /** First configured device's /24, e.g. host 192.168.1.108 -> "192.168.1.0/24". */
  _defaultCidr() {
    const first = Object.values(this.workspace.dahua_devices || {})[0]
    if (!first?.host) throw new Error('No cidr given and no configured device to infer a subnet from')
    const octets = first.host.split('.')
    octets[3] = '0'
    return `${octets.join('.')}/24`
  }

  /** Only /24 (the common LAN case) is supported — good enough for "scan my subnet", not a general CIDR library. */
  _hostsInCidr(cidr) {
    const [base, maskStr] = cidr.split('/')
    const mask = parseInt(maskStr, 10)
    if (mask !== 24) throw new Error(`Only /24 subnets are supported for discovery (got /${mask})`)
    const octets = base.split('.')
    const prefix = octets.slice(0, 3).join('.')
    const hosts = []
    for (let i = 1; i <= 254; i++) hosts.push(`${prefix}.${i}`)
    return hosts
  }

  /** Resolve raw connection details (host/port/creds) for RTSP URL building, without touching the DigestFetch client. */
  _devConfig(deviceId) {
    const targetDevice = deviceId || Object.keys(this.workspace.dahua_devices || {})[0]
    const dev = this.workspace.dahua_devices && this.workspace.dahua_devices[targetDevice]
    if (!dev) throw new Error(`Dahua device ${targetDevice || '(default)'} not found`)
    return { ...dev, deviceId: targetDevice }
  }

  /** List channel index -> name via the standard NVR ChannelTitle config table. Single cameras report one channel. */
  async _channels(deviceId) {
    const res = await this._get(deviceId, 'configManager.cgi?action=getConfig&name=ChannelTitle')
    const text = await res.text()
    const channels = []
    text.split('\n').forEach(line => {
      const m = line.match(/table\.ChannelTitle\[(\d+)\]\.Name=(.*)/)
      if (m) channels.push({ channel: Number(m[1]) + 1, name: m[2].trim() || `Channel ${Number(m[1]) + 1}` })
    })
    return channels.length ? channels : [{ channel: 1, name: 'Channel 1' }]
  }

  /** "2026-7-22 09:05:00" (space kept literal — the caller passes it through a URL where %20 is fine too) */
  _fmtLogTime(date) {
    const p = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  }

  /**
   * Historical log query via Dahua's stateful log.cgi cursor API:
   * action=startFind (returns token+count) -> action=doFind (paged fetch) -> action=stopFind (release).
   * A single-shot "find" with inline start/end times (what earlier code assumed) does not exist on
   * real firmware and always 400s — confirmed against a live DH-XVR1B04-I.
   */
  async _findLogs(deviceId, { startDate, endDate, category = 'Alarm', limit = 200 }) {
    const startRes = await this._get(deviceId, `log.cgi?action=startFind&condition.StartTime=${encodeURIComponent(this._fmtLogTime(startDate))}&condition.EndTime=${encodeURIComponent(this._fmtLogTime(endDate))}&condition.Type=${category}`)
    const startText = await startRes.text()
    const token = (startText.match(/token=(\d+)/) || [])[1]
    const count = parseInt((startText.match(/count=(\d+)/) || [])[1] || '0', 10)
    if (!token || !count) return []

    try {
      const toFetch = Math.min(count, limit)
      const findRes = await this._get(deviceId, `log.cgi?action=doFind&token=${token}&count=${toFetch}`)
      const findText = await findRes.text()
      return this._parseLogItems(findText)
    } finally {
      await this._get(deviceId, `log.cgi?action=stopFind&token=${token}`).catch(() => {})
    }
  }

  /** Parses `items[N].Key=value` blocks, folding wrapped continuation lines (e.g. multi-line Detail) back into the same key. */
  _parseLogItems(text) {
    const items = []
    let curIdx = null, curKey = null
    text.split('\n').forEach(rawLine => {
      const line = rawLine.replace(/\r$/, '')
      const m = line.match(/^items\[(\d+)\]\.(\w+)=(.*)$/)
      if (m) {
        const [, idx, key, val] = m
        items[idx] = items[idx] || {}
        items[idx][key] = val
        curIdx = idx; curKey = key
      } else if (curIdx !== null && curKey !== null && line.trim() !== '') {
        items[curIdx][curKey] += `\n${line}`
      }
    })
    return items.filter(Boolean)
  }

  /** Reads events persisted by src/core/dahua-notifier.js (motion history Dahua itself never retains). */
  _readEventsLog() {
    const events = []
    for (const p of [`${EVENTS_LOG_PATH}.1`, EVENTS_LOG_PATH]) {
      if (!fs.existsSync(p)) continue
      fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
        if (!line.trim()) return
        try { events.push(JSON.parse(line)) } catch (_) { /* skip malformed line */ }
      })
    }
    return events
  }

  /**
   * Turns free text into a time range + intent, no LLM required. Understands relative
   * day-parts ("yesterday", "last night", "this morning", "today") and explicit windows
   * ("last 3 hours", "last 45 minutes"), defaulting to the last 24h. Also flags whether the
   * query is about motion-type events vs. system/account-type events (both if neither/both
   * are mentioned) so dahua.events.search knows which source(s) to check.
   */
  _parseSearchQuery(query = '') {
    const q = query.toLowerCase()
    const now = new Date()
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)
    let start, end = now

    const hoursMatch = q.match(/last\s+(\d+)\s*h(ou)?r?s?/)
    const minsMatch = q.match(/last\s+(\d+)\s*m(in)?(ute)?s?/)

    if (/last night/.test(q)) {
      const y = new Date(now); y.setDate(y.getDate() - 1)
      start = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 18, 0, 0)
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0)
    } else if (/yesterday/.test(q)) {
      const y = new Date(now); y.setDate(y.getDate() - 1)
      start = startOfDay(y)
      end = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59)
    } else if (/this morning/.test(q)) {
      start = startOfDay(now)
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0)
    } else if (/this week/.test(q)) {
      start = new Date(now.getTime() - 7 * 24 * 3600_000)
    } else if (hoursMatch) {
      start = new Date(now.getTime() - Number(hoursMatch[1]) * 3600_000)
    } else if (minsMatch) {
      start = new Date(now.getTime() - Number(minsMatch[1]) * 60_000)
    } else if (/today/.test(q)) {
      start = startOfDay(now)
    } else {
      start = new Date(now.getTime() - 24 * 3600_000) // default: last 24h
    }

    return {
      start,
      end,
      motionIntent: /motion|moved|movement|someone|person|human|people|walked|entered|vehicle|car/.test(q),
      systemIntent: /login|logged|reboot|restart|tamper|video ?loss|conflict|access|password|user/.test(q)
    }
  }

  /**
   * Free-text search over (1) the local motion event log this process has actually observed
   * (dahua-notifier.js persists it — Dahua's own log doesn't retain motion, confirmed live)
   * and (2) each device's historical Alarm-category log (logins, tamper, video loss, etc).
   * A device being unreachable only drops that device's system-log results, not the whole search.
   */
  async _searchEvents({ query = '', device, minutes } = {}) {
    const { start, end, motionIntent, systemIntent } = this._parseSearchQuery(query)
    const rangeStart = minutes ? new Date(Date.now() - minutes * 60_000) : start
    const rangeEnd = end
    const targetDeviceIds = device ? [device] : Object.keys(this.workspace.dahua_devices || {})
    const qLower = query.toLowerCase()

    // Best-effort channel-name matching (e.g. "front door" -> channel 1 on shop1). A device
    // being unreachable here just means no channel filter for it, not a search failure.
    const channelFilter = {}
    for (const id of targetDeviceIds) {
      try {
        const channels = await this._channels(id)
        const matched = channels.filter(c => qLower.includes(c.name.toLowerCase()))
        channelFilter[id] = matched.length ? new Set(matched.map(c => c.channel)) : null
      } catch (_) {
        channelFilter[id] = null
      }
    }

    const results = []

    if (!systemIntent || motionIntent) {
      for (const ev of this._readEventsLog()) {
        if (!targetDeviceIds.includes(ev.device) || ev.action !== 'Start') continue
        const ts = new Date(ev.ts)
        if (ts < rangeStart || ts > rangeEnd) continue
        const chFilter = channelFilter[ev.device]
        if (chFilter && !chFilter.has(ev.channel)) continue
        results.push({ source: 'motion', device: ev.device, time: ev.ts, code: ev.code, channel: ev.channel })
      }
    }

    // Types that fire constantly and are pure noise for "did anything happen" (disk health
    // checks every ~30min, clock sync) — excluded unless the query explicitly names them.
    const noiseTypes = ['S.M.A.R.T', 'Sync System Time']

    if (!motionIntent || systemIntent) {
      for (const id of targetDeviceIds) {
        try {
          const items = await this._findLogs(id, { startDate: rangeStart, endDate: rangeEnd, category: 'Alarm', limit: 200 })
          const chFilter = channelFilter[id]
          for (const it of items) {
            if (noiseTypes.includes(it.Type) && !qLower.includes(it.Type.toLowerCase())) continue
            if (chFilter) {
              const chMatch = (it.Detail || '').match(/Channel:<(\d+)>/)
              const itemChannel = chMatch ? Number(chMatch[1]) + 1 : null
              if (itemChannel !== null && !chFilter.has(itemChannel)) continue
            }
            results.push({ source: 'system-log', device: id, time: it.Time, code: it.Type, detail: it.Detail })
          }
        } catch (_) { /* device unreachable — skip just this device's system log */ }
      }
    }

    results.sort((a, b) => new Date(a.time) - new Date(b.time))
    // Dahua occasionally double-logs the exact same event (e.g. digest re-auth on the same
    // login) — collapse consecutive identical {device, code, time} entries.
    const deduped = results.filter((ev, i) => {
      const prev = results[i - 1]
      return !prev || prev.device !== ev.device || prev.code !== ev.code || prev.time !== ev.time
    })
    const capped = deduped.slice(-100) // most recent 100 — plenty for a summary, keeps the payload sane
    return { query, start: rangeStart.toISOString(), end: rangeEnd.toISOString(), count: capped.length, truncated: deduped.length > capped.length, events: capped }
  }

  /** Vision-capable Gemini call, falling back to Claude on any failure (quota, auth, network). */
  async _askVisionAI({ imageBase64, prompt }) {
    const errors = []
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })
      const result = await model.generateContent([
        { text: prompt },
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
      ])
      return { text: result.response.text(), provider: 'gemini' }
    } catch (e) {
      errors.push(`gemini: ${e.message}`)
    }

    try {
      const Anthropic = require('@anthropic-ai/sdk')
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const result = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } }
          ]
        }]
      })
      return { text: result.content[0]?.text || '', provider: 'claude' }
    } catch (e) {
      errors.push(`claude: ${e.message}`)
    }

    throw new Error(`Both AI providers failed — ${errors.join(' | ')}`)
  }

  /** Text-only counterpart of _askVisionAI, same Gemini-then-Claude fallback. */
  async _askTextAI({ prompt }) {
    const errors = []
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })
      const result = await model.generateContent(prompt)
      return { text: result.response.text(), provider: 'gemini' }
    } catch (e) {
      errors.push(`gemini: ${e.message}`)
    }

    try {
      const Anthropic = require('@anthropic-ai/sdk')
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const result = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
      return { text: result.content[0]?.text || '', provider: 'claude' }
    } catch (e) {
      errors.push(`claude: ${e.message}`)
    }

    throw new Error(`Both AI providers failed — ${errors.join(' | ')}`)
  }

  /**
   * Parses the "SUMMARY: ...\nCONFIDENCE: NN" structure requested in prompts below.
   * Falls back to treating the whole response as the summary with no confidence
   * score if the model doesn't follow the format — never throws.
   */
  _parseConfidence(text) {
    const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?:\n+CONFIDENCE:|$)/i)
    const confidenceMatch = text.match(/CONFIDENCE:\s*(\d{1,3})/i)
    const summary = (summaryMatch ? summaryMatch[1] : text).trim()
    const confidence = confidenceMatch ? Math.min(100, parseInt(confidenceMatch[1], 10)) : null
    return { summary, confidence }
  }

  /** "What's happening right now" — snapshot + vision description of the live scene, with a self-reported confidence score. */
  async _describeScene(deviceId, channel = 1) {
    const dev = this._devConfig(deviceId)
    const snap = await this._get(deviceId, `snapshot.cgi?channel=${channel}`)
    const buf = Buffer.from(await snap.arrayBuffer())
    const prompt = `This is a live security camera snapshot from channel ${channel} of "${dev.name || dev.deviceId}". ` +
      `Describe what's happening in one or two short sentences — focus on people, movement, and anything notable. ` +
      `If the scene looks empty/normal, just say so plainly. Image quality, lighting, or an obstructed view can make ` +
      `this hard to judge, so also rate your own confidence in this description.\n\n` +
      `Respond in exactly this format:\nSUMMARY: <your description>\nCONFIDENCE: <0-100, your certainty in that description>`
    const { text, provider } = await this._askVisionAI({ imageBase64: buf.toString('base64'), prompt })
    const { summary, confidence } = this._parseConfidence(text)
    return { device: dev.deviceId, channel, summary, confidence, provider }
  }

  /** Turns a dahua.events.search result set into a natural-language summary instead of a raw list. */
  async _summarizeEvents({ query, device, minutes }) {
    const search = await this._searchEvents({ query, device, minutes })
    if (!search.events.length) {
      return { ...search, summary: 'Nothing found in that time range.', confidence: 100, provider: null }
    }
    const compact = search.events.map(e => `${e.time} [${e.device}] ${e.code}${e.channel ? ` ch${e.channel}` : ''}`).join('\n')
    const prompt = `Here is a raw event log from CCTV cameras (motion detections and system events), oldest first:\n\n${compact}\n\n` +
      `The user asked: "${query}". Write a short, plain-English summary (3-5 sentences max) answering their question — ` +
      `group repeated/similar events instead of listing every line, call out anything that looks notable (tampering, unusual hours, repeated logins), ` +
      `and mention if nothing significant happened. Respond in the SAME language the user asked in, whatever that is. ` +
      `Also rate your confidence that this summary fully answers their question, given the event log may be incomplete ` +
      `(e.g. a device was unreachable during part of the search).\n\n` +
      `Respond in exactly this format:\nSUMMARY: <your answer, in the user's language>\nCONFIDENCE: <0-100>`
    const { text, provider } = await this._askTextAI({ prompt })
    const { summary, confidence } = this._parseConfidence(text)
    return { ...search, summary, confidence, provider }
  }

  /**
   * Open Dahua's real-time multipart event push (eventManager.cgi?action=attach) and call
   * onEvent({code, action, channel, data}) as events arrive. This is the ONLY way to observe
   * VideoMotion/IVS events live — they are not retrievable from the historical log (confirmed:
   * 30 days of log history on a live device had zero VideoMotion/CrossLine entries even with
   * motion actively firing on the real-time stream).
   * Returns { stop() } to close the connection. onClose(err) fires on disconnect (err is null
   * for a clean EOF) unless the caller already called stop().
   */
  async streamEvents(deviceId, { codes = ['All'], onEvent, onClose } = {}) {
    const { client, base } = await this._client(deviceId)
    const res = await client.fetch(`${base}/eventManager.cgi?action=attach&codes=[${codes.join(',')}]`, { dispatcher: insecureDispatcher })
    if (!res.ok) throw new Error(`Dahua eventManager attach failed: ${res.status}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let stopped = false

    ;(async () => {
      let err = null
      try {
        while (!stopped) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('--myboundary')
          buffer = parts.pop()
          for (const part of parts) {
            const m = part.match(/Code=([^;]+);action=([^;]+);index=(\d+)/)
            if (!m) continue
            const dataMatch = part.match(/data=([\s\S]*)$/)
            let data
            if (dataMatch) {
              try { data = JSON.parse(dataMatch[1].trim()) } catch (_) { data = dataMatch[1].trim() }
            }
            onEvent && onEvent({ code: m[1], action: m[2], channel: Number(m[3]) + 1, data })
          }
        }
      } catch (e) {
        err = e
      }
      if (!stopped) onClose && onClose(err)
    })()

    return { stop: () => { stopped = true; reader.cancel().catch(() => {}) } }
  }

  /** Checks every configured device (not just the first) — matches how system.doctor aggregates per-skill health. */
  async healthCheck() {
    const deviceIds = Object.keys(this.workspace.dahua_devices || {})
    if (!deviceIds.length) return { status: 'ok', note: 'no Dahua devices configured' }

    const devices = {}
    for (const id of deviceIds) {
      try {
        await this._get(id, 'magicBox.cgi?action=getMachineName')
        devices[id] = { status: 'ok' }
      } catch (e) {
        devices[id] = { status: 'error', error: e.message }
      }
    }
    const anyDown = Object.values(devices).some(d => d.status !== 'ok')
    return { status: anyDown ? 'degraded' : 'ok', devices }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'dahua.device.list':
          return Object.keys(this.workspace.dahua_devices || {}).map(id => {
            const dev = this.workspace.dahua_devices[id];
            return { id, host: dev.host, driver: dev.driver, name: dev.name || id };
          });

        case 'dahua.device.info': {
          const targetInfoDevice = args.device || Object.keys(this.workspace.dahua_devices || {})[0];
          const info = await this._get(targetInfoDevice, 'magicBox.cgi?action=getDeviceType')
          const name = await this._get(targetInfoDevice, 'magicBox.cgi?action=getMachineName')
          const serial = await this._get(targetInfoDevice, 'magicBox.cgi?action=getSerialNo')
          const version = await this._get(targetInfoDevice, 'magicBox.cgi?action=getSoftwareVersion')
          return {
            device: targetInfoDevice,
            type: (await info.text()).split('=')[1]?.trim(),
            name: (await name.text()).split('=')[1]?.trim(),
            serial: (await serial.text()).split('=')[1]?.trim(),
            version: (await version.text()).split('=')[1]?.trim()
          }
        }

        case 'dahua.snapshot.get': {
          const ch = args.channel || 1
          const snap = await this._get(args.device, `snapshot.cgi?channel=${ch}`)
          const buf = Buffer.from(await snap.arrayBuffer())
          // Return base64 for Slack/Telegram. AgentOS gateway can convert to file.
          return {
            channel: ch,
            mime: 'image/jpeg',
            base64: buf.toString('base64'),
            size: buf.length
          }
        }

        case 'dahua.device.channels':
          return this._channels(args.device)

        case 'dahua.snapshot.getAll': {
          const channels = await this._channels(args.device)
          const shots = await Promise.all(channels.map(async ({ channel, name: chName }) => {
            try {
              const shotRes = await this._get(args.device, `snapshot.cgi?channel=${channel}`)
              const shotBuf = Buffer.from(await shotRes.arrayBuffer())
              return { channel, name: chName, mime: 'image/jpeg', base64: shotBuf.toString('base64'), size: shotBuf.length }
            } catch (e) {
              return { channel, name: chName, error: e.message }
            }
          }))
          return shots
        }

        case 'dahua.stream.url': {
          const streamDevice = this._devConfig(args.device)
          const streamCh = args.channel || 1
          const rtspPort = streamDevice.rtspPort || 554
          const auth = `${encodeURIComponent(streamDevice.user)}:${encodeURIComponent(streamDevice.password)}`
          const rtspBase = `rtsp://${auth}@${streamDevice.host}:${rtspPort}/cgi-bin/realmonitor?channel=${streamCh}`
          return {
            device: streamDevice.deviceId,
            channel: streamCh,
            main: `${rtspBase}&subtype=0`,
            sub: `${rtspBase}&subtype=1`,
            note: 'Open with an RTSP-capable player (VLC, ffmpeg, mobile NVR app). Sub stream is lower resolution/bandwidth.'
          }
        }

        case 'dahua.ptz.move': {
          const targetMoveDevice = args.device || Object.keys(this.workspace.dahua_devices || {})[0];
          this.logger.warn(`DAHUA PTZ ${args.action} on ${targetMoveDevice}`, { user: ctx.userId, reason: args.reason })
          const ch1 = args.channel || 1
          const cmd = `ptz.cgi?action=start&channel=${ch1}&code=${args.action}&arg1=0&arg2=${args.speed || 4}&arg3=0`
          await this._get(targetMoveDevice, cmd)
          // Auto-stop after 1s for safety
          setTimeout(() => this._get(targetMoveDevice, `ptz.cgi?action=stop&channel=${ch1}&code=${args.action}`), 1000)
          return { device: targetMoveDevice, channel: ch1, action: args.action, status: 'moving' }
        }

        case 'dahua.ptz.preset': {
          const targetPresetDevice = args.device || Object.keys(this.workspace.dahua_devices || {})[0];
          this.logger.warn(`DAHUA PRESET ${args.preset} on ${targetPresetDevice}`, { user: ctx.userId, reason: args.reason })
          const ch2 = args.channel || 1
          await this._get(targetPresetDevice, `ptz.cgi?action=start&channel=${ch2}&code=GotoPreset&arg1=0&arg2=${args.preset}&arg3=0`)
          return { device: targetPresetDevice, channel: ch2, preset: args.preset }
        }

        case 'dahua.events.subscribe': {
          // Historical query via the log.cgi cursor API (see _findLogs). Note: on real firmware,
          // VideoMotion/IVS events are NOT retained in this log — use dahua.events.stream (or the
          // notifier, which uses streamEvents()) for live motion. This tool surfaces what IS logged
          // here: system/account/alarm-category events like Illegal Login, Video Loss, IP Conflict.
          const end = new Date()
          const start = new Date(end.getTime() - (args.minutes || 60) * 60000)
          const items = await this._findLogs(args.device, { startDate: start, endDate: end, category: 'Alarm', limit: 200 })
          const requestedCodes = args.codes && args.codes.length ? args.codes : null
          const filtered = requestedCodes ? items.filter(it => requestedCodes.includes(it.Type)) : items
          return filtered.slice(-50) // most recent 50
        }

        case 'dahua.system.reboot': {
          const targetRebootDevice = args.device || Object.keys(this.workspace.dahua_devices || {})[0];
          this.logger.warn(`DAHUA REBOOT ${targetRebootDevice}`, { user: ctx.userId, reason: args.reason })
          await this._get(targetRebootDevice, 'magicBox.cgi?action=reboot')
          return { device: targetRebootDevice, status: 'rebooting' }
        }

        case 'dahua.device.discover':
          return this._discoverDevices({
            cidr: args.cidr,
            port: args.port,
            timeoutMs: args.timeoutMs,
            concurrency: args.concurrency
          })

        case 'dahua.events.search':
          return this._searchEvents({ query: args.query, device: args.device, minutes: args.minutes })

        case 'dahua.scene.describe':
          return this._describeScene(args.device, args.channel || 1)

        case 'dahua.events.summarize':
          return this._summarizeEvents({ query: args.query, device: args.device, minutes: args.minutes })

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Dahua ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

export default DahuaSkill;
