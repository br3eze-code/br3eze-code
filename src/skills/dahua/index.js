const _digestFetch = require('digest-fetch')
const DigestFetch = _digestFetch.default || _digestFetch
const { BaseSkill } = require('../base.js')

class DahuaSkill extends BaseSkill {
  static id = 'dahua'
  static name = 'Dahua CCTV'
  static description = 'Control Dahua cameras/NVRs: PTZ, snapshots, events, device mgmt'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.clients = new Map() // deviceId -> DigestFetch client
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
      }
    }
  }

  _client(deviceId) {
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

    const client = new DigestFetch(dev.user, dev.password)
    this.clients.set(targetDevice, { client, base: `http://${dev.host}:${dev.port || 80}/cgi-bin`, deviceId: targetDevice })
    return this.clients.get(targetDevice)
  }

  async _get(deviceId, path) {
    const { client, base, deviceId: resolvedId } = this._client(deviceId)
    const res = await client.fetch(`${base}/${path}`)
    if (!res.ok) throw new Error(`Dahua API ${res.status} on device ${resolvedId}: ${await res.text()}`)
    return res
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
    const { client, base } = this._client(deviceId)
    const res = await client.fetch(`${base}/eventManager.cgi?action=attach&codes=[${codes.join(',')}]`)
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

  async healthCheck() {
    const first = Object.keys(this.workspace.dahua_devices || {})[0]
    if (!first) return { status: 'ok', note: 'no Dahua devices configured' }
    await this._get(first, 'magicBox.cgi?action=getMachineName')
    return { status: 'ok' }
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

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Dahua ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = DahuaSkill
