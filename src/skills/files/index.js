const { BaseSkill } = require('../base.js')
const axios = require('axios')
const { google } = require('googleapis')
const fs = require('fs/promises')
const path = require('path')

class FileStorageSkill extends BaseSkill {
  static id = 'files'
  static name = 'File Storage'
  static description = 'OneDrive + Google Drive: upload, download, list, sync, share'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
    this.gdrive = null
    this.onedriveToken = null
  }

  async init() {
    // Google Drive - service account or OAuth
    if (this.config.gdrive_credentials) {
      const auth = new google.auth.GoogleAuth({
        keyFile: this.config.gdrive_credentials,
        scopes: ['https://www.googleapis.com/auth/drive']
      })
      this.gdrive = google.drive({ version: 'v3', auth })
    }
  }

  static getTools() {
    return {
      'files.onedrive': {
        risk: 'low',
        description: 'OneDrive: upload, download, list, share, sync',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['upload', 'download', 'list', 'share', 'delete'], default: 'list' },
            file: { type: 'string', description: 'local path or file ID' },
            folder: { type: 'string', description: '/Music/Projects', default: '/' },
            name: { type: 'string', description: 'remote filename' },
            link_type: { type: 'string', enum: ['view', 'edit'], default: 'view' }
          },
          required: ['action']
        }
      },
      'files.gdrive': {
        risk: 'low',
        description: 'Google Drive: upload, download, list, share, sync',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['upload', 'download', 'list', 'share', 'delete', 'search'], default: 'list' },
            file: { type: 'string', description: 'local path or file ID' },
            folder_id: { type: 'string', description: 'Drive folder ID or name' },
            name: { type: 'string' },
            query: { type: 'string', description: 'name contains "mix"' },
            mime_type: { type: 'string', default: 'application/octet-stream' }
          },
          required: ['action']
        }
      },
      'files.sync': {
        risk: 'low',
        description: 'Sync workspace ↔ cloud: bidirectional, selective',
        parameters: {
          type: 'object',
          properties: {
            service: { type: 'string', enum: ['onedrive', 'gdrive', 'both'], default: 'both' },
            direction: { type: 'string', enum: ['up', 'down', 'both'], default: 'both' },
            folder: { type: 'string', default: '/Projects' },
            pattern: { type: 'string', description: '*.flp,*.wav', default: '*' }
          },
          required: ['service']
        }
      },
      'files.bucket': {
        risk: 'low',
        description: 'S3-compatible buckets: upload/download for stems, projects',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['upload', 'download', 'list'], default: 'list' },
            bucket: { type: 'string', description: 'fl-projects' },
            key: { type: 'string', description: 'path/to/file.flp' },
            file: { type: 'string', description: 'local path' }
          },
          required: ['action', 'bucket']
        }
      }
    }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
        case 'files.onedrive':
          return await this._onedrive(args, ctx)
        case 'files.gdrive':
          return await this._gdrive(args, ctx)
        case 'files.sync':
          return await this._sync(args, ctx)
        case 'files.bucket':
          return await this._bucket(args, ctx)
        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Files ${toolName} failed: ${e.message}`)
      throw e
    }
  }

  async _onedrive(args, ctx) {
    const token = this.onedriveToken || this.config.onedrive_token
    if (!token) throw new Error('OneDrive token required. Run OAuth flow or set onedrive_token in config.')
    
    const headers = { Authorization: `Bearer ${token}` }
    const base = 'https://graph.microsoft.com/v1.0/me/drive'

    if (args.action === 'list') {
      const path = args.folder === '/'? '/root/children' : `/root:${args.folder}:/children`
      const res = await axios.get(`${base}${path}`, { headers })
      return {
        action: 'list',
        folder: args.folder,
        files: res.data.value.map(f => ({
          name: f.name,
          id: f.id,
          size: f.size,
          modified: f.lastModifiedDateTime,
          type: f.folder? 'folder' : 'file'
        }))
      }
    }

    if (args.action === 'upload') {
      const data = await fs.readFile(args.file)
      const name = args.name || path.basename(args.file)
      const uploadPath = args.folder === '/'? `/root:/${name}:/content` : `/root:${args.folder}/${name}:/content`
      const res = await axios.put(`${base}${uploadPath}`, data, { headers })
      return { action: 'upload', name, id: res.data.id, url: res.data.webUrl }
    }

    if (args.action === 'download') {
      const res = await axios.get(`${base}/items/${args.file}/content`, { headers, responseType: 'arraybuffer' })
      const localPath = `${this.workspace}/${args.name || 'download'}`
      await fs.writeFile(localPath, res.data)
      return { action: 'download', path: localPath, size: res.data.length }
    }

    if (args.action === 'share') {
      const res = await axios.post(`${base}/items/${args.file}/createLink`, {
        type: args.link_type,
        scope: 'anonymous'
      }, { headers })
      return { action: 'share', link: res.data.link.webUrl, type: args.link_type }
    }

    if (args.action === 'delete') {
      await axios.delete(`${base}/items/${args.file}`, { headers })
      return { action: 'delete', file: args.file }
    }
  }

  async _gdrive(args, ctx) {
    if (!this.gdrive) throw new Error('Google Drive not configured. Set gdrive_credentials in config.')

    if (args.action === 'list') {
      const q = args.folder_id? `'${args.folder_id}' in parents` : null
      const res = await this.gdrive.files.list({
        q,
        pageSize: 50,
        fields: 'files(id,name,size,modifiedTime,mimeType,webViewLink)'
      })
      return {
        action: 'list',
        files: res.data.files.map(f => ({
          name: f.name,
          id: f.id,
          size: f.size,
          modified: f.modifiedTime,
          type: f.mimeType,
          url: f.webViewLink
        }))
      }
    }

    if (args.action === 'upload') {
      const media = { mimeType: args.mime_type, body: require('fs').createReadStream(args.file) }
      const fileMetadata = { name: args.name || path.basename(args.file), parents: args.folder_id? [args.folder_id] : [] }
      const res = await this.gdrive.files.create({ requestBody: fileMetadata, media, fields: 'id,name,webViewLink' })
      return { action: 'upload', name: res.data.name, id: res.data.id, url: res.data.webViewLink }
    }

    if (args.action === 'download') {
      const res = await this.gdrive.files.get({ fileId: args.file, alt: 'media' }, { responseType: 'stream' })
      const localPath = `${this.workspace}/${args.name || 'download'}`
      const dest = require('fs').createWriteStream(localPath)
      await new Promise((resolve, reject) => {
        res.data.pipe(dest).on('finish', resolve).on('error', reject)
      })
      return { action: 'download', path: localPath }
    }

    if (args.action === 'share') {
      await this.gdrive.permissions.create({
        fileId: args.file,
        requestBody: { role: 'reader', type: 'anyone' }
      })
      const res = await this.gdrive.files.get({ fileId: args.file, fields: 'webViewLink' })
      return { action: 'share', link: res.data.webViewLink }
    }

    if (args.action === 'search') {
      const res = await this.gdrive.files.list({ q: args.query, pageSize: 20, fields: 'files(id,name,webViewLink)' })
      return { action: 'search', query: args.query, files: res.data.files }
    }

    if (args.action === 'delete') {
      await this.gdrive.files.delete({ fileId: args.file })
      return { action: 'delete', file: args.file }
    }
  }

  async _sync(args, ctx) {
    const results = []
    
    if (args.service === 'onedrive' || args.service === 'both') {
      // Upload local workspace files matching pattern
      const files = await fs.readdir(this.workspace)
      const matches = files.filter(f => args.pattern === '*' || f.match(args.pattern.replace('*', '.*')))
      for (const f of matches) {
        const res = await this._onedrive({
          action: 'upload',
          file: `${this.workspace}/${f}`,
          folder: args.folder,
          name: f
        }, ctx)
        results.push({ service: 'onedrive', ...res })
      }
    }

    if (args.service === 'gdrive' || args.service === 'both') {
      const files = await fs.readdir(this.workspace)
      const matches = files.filter(f => args.pattern === '*' || f.match(args.pattern.replace('*', '.*')))
      for (const f of matches) {
        const res = await this._gdrive({
          action: 'upload',
          file: `${this.workspace}/${f}`,
          name: f
        }, ctx)
        results.push({ service: 'gdrive', ...res })
      }
    }

    return { service: args.service, direction: args.direction, synced: results.length, files: results }
  }

  async _bucket(args, ctx) {
    // S3-compatible: use AWS SDK or MinIO
    const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3')
    const s3 = new S3Client({
      region: this.config.s3_region || 'us-east-1',
      credentials: {
        accessKeyId: this.config.s3_access_key,
        secretAccessKey: this.config.s3_secret_key
      },
      endpoint: this.config.s3_endpoint // for MinIO/R2
    })

    if (args.action === 'upload') {
      const data = await fs.readFile(args.file)
      await s3.send(new PutObjectCommand({ Bucket: args.bucket, Key: args.key, Body: data }))
      return { action: 'upload', bucket: args.bucket, key: args.key }
    }

    if (args.action === 'download') {
      const res = await s3.send(new GetObjectCommand({ Bucket: args.bucket, Key: args.key }))
      const localPath = `${this.workspace}/${path.basename(args.key)}`
      await fs.writeFile(localPath, res.Body)
      return { action: 'download', path: localPath }
    }

    if (args.action === 'list') {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: args.bucket, Prefix: args.key }))
      return {
        action: 'list',
        bucket: args.bucket,
        files: res.Contents?.map(o => ({ key: o.Key, size: o.Size, modified: o.LastModified })) || []
      }
    }
  }
}

module.exports = FileStorageSkill
