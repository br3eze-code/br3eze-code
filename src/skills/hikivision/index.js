import DigestFetch from 'digest-fetch';
import { parseStringPromise } from 'xml2js';
import { BaseSkill } from '../base.js';


class HikvisionSkill extends BaseSkill {
  static id = 'hikvision'
  static name = 'Hikvision CCTV'
  static description = 'Control Hikvision cameras/NVRs via ISAPI'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.clients = new Map()
  }

  static getTools() {
    return {
      'hik.device.list': {
        risk: 'low',
        description: 'List configured Hikvision and compatible OEM devices',
        parameters: { type: 'object', properties: {}, required: [] }
      },
      'hik.device.channels': {
        risk: 'low',
        description: 'List streaming channels configured on a Hikvision device',
        parameters: {
          type: 'object',
          properties: { device: { type: 'string' } },
          required: ['device']
        }
      },
      'hik.stream.url': {
        risk: 'low',
        description: 'Build a live RTSP URL for a Hikvision channel',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string' },
            channel: { type: 'number', default: 101 },
            subtype: { type: 'number', default: 0, description: '0=main stream, 1=sub stream' }
          },
          required: ['device']
        }
      },
      'hik.device.info': {
        risk: 'low',
        description: 'Get device info: model, firmware, serial',
        parameters: {
          type: 'object',
          properties: { device: { type: 'string' } },
          required: ['device']
        }
      },
      'hik.snapshot.get': {
        risk: 'low',
        description: 'Get JPEG snapshot from channel',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string' },
            channel: { type: 'number', default: 101, description: '101=ch1 main, 102=ch1 sub' }
          },
          required: ['device']
        }
      },
      'hik.ptz.move': {
        risk: 'medium',
        description: 'PTZ continuous move. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string' },
            channel: { type: 'number', default: 1 },
            pan: { type: 'number', minimum: -100, maximum: 100, default: 0 },
            tilt: { type: 'number', minimum: -100, maximum: 100, default: 0 },
            zoom: { type: 'number', minimum: -100, maximum: 100, default: 0 },
            duration: { type: 'number', default: 1000, maximum: 5000 },
            reason: { type: 'string' }
          },
          required: ['device', 'reason']
        }
      },
      'hik.ptz.preset': {
        risk: 'medium',
        description: 'Go to PTZ preset. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string' },
            channel: { type: 'number', default: 1 },
            preset: { type: 'number', minimum: 1, maximum: 300 },
            reason: { type: 'string' }
          },
          required: ['device', 'preset', 'reason']
        }
      },
      'hik.events.search': {
        risk: 'low',
        description: 'Search event logs: VMD, linedetection, fielddetection',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string' },
            eventTypes: { type: 'array', items: { type: 'string' }, default: ['VMD'] },
            minutes: { type: 'number', default: 60, maximum: 1440 }
          },
          required: ['device']
        }
      },
      'hik.system.reboot': {
        risk: 'high',
        description: 'Reboot device. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            device: { type: 'string' },
            reason: { type: 'string' }
          },
          required: ['device', 'reason']
        }
      }
    }
  }

  _client(deviceId) {
    if (this.clients.has(deviceId)) return this.clients.get(deviceId)
    const dev = this.workspace.hikvision_devices && this.workspace.hikvision_devices[deviceId]
    const supported = ['hikvision', 'annke', 'lts', 'trendnet', 'laview', 'ezviz']
    if (!dev || !supported.includes((dev.driver || '').toLowerCase())) {
        throw new Error(`Hikvision/OEM device ${deviceId} not found or unsupported driver`)
    }
    const client = new DigestFetch(dev.user, dev.password)
    const base = `http://${dev.host}:${dev.port || 80}/ISAPI`
    this.clients.set(deviceId, { client, base })
    return { client, base }
  }

  async _get(deviceId, path) {
    const { client, base } = this._client(deviceId)
    const res = await client.fetch(`${base}/${path}`)
    if (!res.ok) throw new Error(`Hikvision API ${res.status}: ${await res.text()}`)
    return res
  }

  async _put(deviceId, path, xml) {
    const { client, base } = this._client(deviceId)
    const res = await client.fetch(`${base}/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/xml' },
      body: xml
    })
    if (!res.ok) throw new Error(`Hikvision API ${res.status}: ${await res.text()}`)
    return res
  }

  async healthCheck() {
    const devices = Object.keys(this.workspace.hikvision_devices || {})
    if (!devices.length) return { status: 'ok', note: 'no Hikvision devices configured' }
    const results = await Promise.all(devices.map(async (device) => {
      try { await this._get(device, 'System/deviceInfo'); return { device, status: 'ok' } }
      catch (error) { return { device, status: 'error', error: error.message } }
    }))
    return { status: results.every(result => result.status === 'ok') ? 'ok' : 'degraded', devices: results }
  }

  _configuredDevices() {
    return Object.entries(this.workspace.hikvision_devices || {}).map(([id, device]) => ({
      id,
      name: device.name || id,
      driver: device.driver || 'hikvision',
      host: device.host,
      port: device.port || 80,
      enabled: device.enabled !== false
    }))
  }

  async _channels(deviceId) {
    const response = await this._get(deviceId, 'Streaming/channels')
    const parsed = await parseStringPromise(await response.text(), { explicitArray: true })
    const nodes = parsed.StreamingChannelList?.StreamingChannel || []
    return nodes.map((node) => ({
      id: Number(node.id?.[0] || 0),
      name: node.channelName?.[0] || node.name?.[0] || `Channel ${node.id?.[0] || ''}`,
      enabled: String(node.enabled?.[0] ?? 'true').toLowerCase() !== 'false',
      videoCodec: node.videoCodecType?.[0] || node.Video?.[0]?.videoCodecType?.[0] || null
    }))
  }

  _streamUrl(deviceId, channel = 101, subtype = 0) {
    const device = this.workspace.hikvision_devices?.[deviceId]
    if (!device?.host) throw new Error(`Hikvision device ${deviceId} not found`)
    const user = encodeURIComponent(device.user || '')
    const password = encodeURIComponent(device.password || '')
    const auth = user ? `${user}:${password}@` : ''
    return `rtsp://${auth}${device.host}:${device.rtspPort || 554}/Streaming/Channels/${channel}?subtype=${subtype}`
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'hik.device.list':
          return this._configuredDevices()

        case 'hik.device.channels':
          return { device: args.device, channels: await this._channels(args.device) }

        case 'hik.stream.url':
          return {
            device: args.device,
            channel: args.channel || 101,
            subtype: args.subtype || 0,
            url: this._streamUrl(args.device, args.channel || 101, args.subtype || 0)
          }

        case 'hik.device.info':
          const res = await this._get(args.device, 'System/deviceInfo')
          const xml = await res.text()
          const json = await parseStringPromise(xml)
          const info = json.DeviceInfo
          return {
            device: args.device,
            deviceName: info.deviceName[0],
            model: info.model[0],
            serial: info.serialNumber[0],
            firmware: info.firmwareVersion[0]
          }

        case 'hik.snapshot.get':
          const ch = args.channel || 101
          const snap = await this._get(args.device, `Streaming/channels/${ch}/picture`)
          const buf = Buffer.from(await snap.arrayBuffer())
          return { channel: ch, mime: 'image/jpeg', base64: buf.toString('base64'), size: buf.length }

        case 'hik.ptz.move':
          this.logger.warn(`HIK PTZ MOVE ${args.device}`, { user: ctx.userId, reason: args.reason })
          const ch1 = args.channel || 1
          const xml1 = `<PTZData><pan>${args.pan || 0}</pan><tilt>${args.tilt || 0}</tilt><zoom>${args.zoom || 0}</zoom></PTZData>`
          await this._put(args.device, `PTZCtrl/channels/${ch1}/continuous`, xml1)
          // Auto-stop
          setTimeout(async () => {
            const stop = '<PTZData><pan>0</pan><tilt>0</tilt><zoom>0</zoom></PTZData>'
            await this._put(args.device, `PTZCtrl/channels/${ch1}/continuous`, stop)
          }, args.duration || 1000)
          return { device: args.device, channel: ch1, status: 'moving' }

        case 'hik.ptz.preset':
          this.logger.warn(`HIK PRESET ${args.preset} on ${args.device}`, { user: ctx.userId, reason: args.reason })
          const ch2 = args.channel || 1
          await this._get(args.device, `PTZCtrl/channels/${ch2}/presets/${args.preset}/goto`)
          return { device: args.device, channel: ch2, preset: args.preset }

        case 'hik.events.search':
          const end = new Date().toISOString()
          const start = new Date(Date.now() - (args.minutes || 60) * 60000).toISOString()
          const searchXML = `<?xml version="1.0" encoding="UTF-8"?>
<CMSSearchDescription>
<searchID>${Date.now()}</searchID>
<trackIDList><trackID>101</trackID></trackIDList>
<timeSpanList><timeSpan><startTime>${start}</startTime><endTime>${end}</endTime></timeSpan></timeSpanList>
<maxResults>50</maxResults>
<searchResultPostion>0</searchResultPostion>
<metadataList><metadataDescriptor>//recordType.meta.std-cgi.com/${args.eventTypes[0]}</metadataDescriptor></metadataList>
</CMSSearchDescription>`
          const search = await this._put(args.device, 'ContentMgmt/search', searchXML)
          const searchText = await search.text()
          const searchJson = await parseStringPromise(searchText)
          const matches = searchJson.CMSSearchResult?.matchList?.[0]?.searchMatchItem || []
          return matches.map(m => ({
            time: m.timeSpan[0].startTime[0],
            type: m.metadataList[0].metadataDescriptor[0],
            source: m.trackID[0]
          }))

        case 'hik.system.reboot':
          this.logger.warn(`HIK REBOOT ${args.device}`, { user: ctx.userId, reason: args.reason })
          await this._put(args.device, 'System/reboot', '')
          return { device: args.device, status: 'rebooting' }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Hikvision ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

export default HikvisionSkill;
