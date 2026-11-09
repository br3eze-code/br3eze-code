import crypto from 'node:crypto';
const DATA_URL=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
const normalizeTenant=value=>String(value||'local').slice(0,128)||'local';
export class DiagnosticCaptureStore {
  constructor({maxBytes=600000,maxTenants=32}={}) {
    this.maxBytes=Math.max(1,Math.min(700000,Number.parseInt(maxBytes,10)||600000));
    this.maxTenants=Math.max(1,Math.min(128,Number.parseInt(maxTenants,10)||32));
    this.captures=new Map();
  }
  record({dataUrl,tenantId='local',width=null,height=null}={}) {
    if(typeof dataUrl!=='string') throw new TypeError('INVALID_SCREEN_CAPTURE');
    const match=DATA_URL.exec(dataUrl);
    if(!match||match[2].length%4!==0) throw new TypeError('INVALID_SCREEN_CAPTURE');
    if(match[2].length>Math.ceil(this.maxBytes/3)*4) throw new RangeError('SCREEN_CAPTURE_TOO_LARGE');
    const bytes=Buffer.from(match[2],'base64');
    if(bytes.toString('base64')!==match[2]) throw new TypeError('INVALID_SCREEN_CAPTURE');
    const validSignature=match[1]==='png'
      ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
    if(!validSignature) throw new TypeError('INVALID_SCREEN_CAPTURE');
    if(bytes.length>this.maxBytes) throw new RangeError('SCREEN_CAPTURE_TOO_LARGE');
    const tenant=normalizeTenant(tenantId);
    const capture=Object.freeze({
      id:'capture-'+crypto.randomBytes(8).toString('hex'),
      timestamp:new Date().toISOString(),tenantId:tenant,mediaType:'image/'+match[1],
      width:Number.isInteger(width)&&width>0&&width<=3840?width:null,
      height:Number.isInteger(height)&&height>0&&height<=2160?height:null,
      byteLength:bytes.length,dataUrl
    });
    this.captures.delete(tenant); this.captures.set(tenant,capture);
    while(this.captures.size>this.maxTenants) this.captures.delete(this.captures.keys().next().value);
    return {...capture};
  }
  getLatest({tenantId='local'}={}) { const c=this.captures.get(normalizeTenant(tenantId)); return c?{...c}:null; }
  getLatestMetadata({tenantId='local'}={}) { const c=this.getLatest({tenantId}); if(!c)return null; const {dataUrl,...metadata}=c; return metadata; }
  clear() { const count=this.captures.size; this.captures.clear(); return count; }
  get size() { return this.captures.size; }
}
export const diagnosticCaptureStore=new DiagnosticCaptureStore();
