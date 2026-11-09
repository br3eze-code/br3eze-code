/**
 * Same-origin observer for local AgentOS PWA diagnostics.
 * Screen capture starts only from a user click and the native browser picker.
 */
export function createBrowserDiagnosticsScript() {
  return String.raw`(()=> {
    if(window.__agentosDiagnosticsInstalled)return;
    window.__agentosDiagnosticsInstalled=true;
    const endpoint='/__agentos/diagnostics/events',captureEndpoint='/__agentos/diagnostics/captures',capturePreview='/__agentos/diagnostics/captures/latest';
    let sent=0,started=Date.now();
    const clean=(v,n=1200)=>String(v??'')
      .replace(/(?:authorization\\s*[:=]\\s*bearer\\s+)[^\\s,;]+/ig,'Authorization: [REDACTED]')
      .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|token)\\s*[:=]\\s*)[^\\s,;]+/ig,'$1[REDACTED]')
      .replace(/\\b(?:sk|pk|ghp|gho|github_pat)_[A-Za-z0-9_-]{8,}/ig,'[REDACTED]').slice(0,n);
    const safePath=value=>{try{const u=new URL(value,location.href);return u.origin===location.origin?u.pathname:u.origin;}catch{return 'unknown';}};
    const originalFetch=window.fetch.bind(window);
    const send=(source,level,message)=>{
      const now=Date.now();if(now-started>60000){started=now;sent=0;}if(sent>=30)return;sent++;
      const payload={source,level,message:clean(message),page:location.pathname,timestamp:new Date().toISOString(),correlationId:document.querySelector('meta[name="agentos-correlation-id"]')?.content||null};
      try{void originalFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'same-origin',keepalive:true}).catch(()=>{});}catch{}
    };
    const originalError=console.error.bind(console);
    console.error=(...args)=>{send('browser.console','error',args.map(a=>a instanceof Error?(a.stack||a.message):String(a)).join(' ').slice(0,1200));originalError(...args);};
    window.addEventListener('error',event=>{
      if(event.target&&event.target!==window){send('browser.network','error','Resource failed to load '+safePath(event.target.src||event.target.href||''));return;}
      send('browser.runtime','error',event.error?.stack||event.message||'Unhandled browser error');
    });
    window.addEventListener('unhandledrejection',event=>send('browser.runtime','error',event.reason instanceof Error?(event.reason.stack||event.reason.message):String(event.reason??'Unhandled promise rejection')));
    const recent=new Map();
    const observeVisibleErrors=()=>{
      const selector='[role="alert"], [aria-live="assertive"], [data-toast-type="error"], [data-sonner-toast][data-type="error"], .toast-error, .notification-error';
      for(const el of document.querySelectorAll(selector)){
        if(!el.getClientRects().length)continue;
        const message=clean(el.innerText||el.textContent||'',600).trim();if(!message)continue;
        if(recent.has(message)&&Date.now()-recent.get(message)<10000)continue;
        recent.set(message,Date.now());if(recent.size>100)recent.clear();send('browser.notification','error',message);
      }
    };
    if(document.documentElement){new MutationObserver(observeVisibleErrors).observe(document.documentElement,{childList:true,subtree:true,characterData:true});observeVisibleErrors();}
    try{
      const Native=window.Notification;
      if(typeof Native==='function'&&!Native.__agentosWrapped){
        function ObservedNotification(title,options={}){
          const notification=new Native(title,options);
          if(Native.permission==='granted'){
            const safeTitle=clean(title,200),tag=options?.tag?' tag='+clean(options.tag,80):'';
            send('browser.notification','info','Browser notification created: '+safeTitle+tag);
            for(const type of ['show','click','close','error'])notification.addEventListener(type,()=>send('browser.notification','info','Browser notification '+type+': '+safeTitle+tag),{once:type==='show'||type==='error'});
          }
          return notification;
        }
        Object.setPrototypeOf(ObservedNotification,Native);ObservedNotification.prototype=Native.prototype;
        Object.defineProperty(ObservedNotification,'__agentosWrapped',{value:true});
        Object.defineProperty(ObservedNotification,'permission',{get:()=>Native.permission});
        ObservedNotification.requestPermission=(...args)=>Native.requestPermission(...args);
        window.Notification=ObservedNotification;
      }
    }catch{}
    const status=document.createElement('span');status.id='agentos-diagnostic-capture-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    status.style.cssText='position:fixed;right:12px;bottom:58px;z-index:2147483647;max-width:min(420px,90vw);padding:8px 10px;border-radius:8px;background:#111827;color:#f9fafb;font:12px/1.4 system-ui;display:none';
    const button=document.createElement('button');button.id='agentos-diagnostic-capture';button.type='button';button.textContent='Capture screen for diagnostics';button.setAttribute('aria-describedby',status.id);
    button.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:10px 12px;border:1px solid #64748b;border-radius:8px;background:#1d4ed8;color:white;font:600 13px system-ui;cursor:pointer';
    button.addEventListener('click',async()=>{
      if(!navigator.mediaDevices||typeof navigator.mediaDevices.getDisplayMedia!=='function'){status.style.display='block';status.textContent='Screen capture is not supported in this browser.';send('browser.screen','warn','Screen capture is not supported in this browser');return;}
      button.disabled=true;status.style.display='block';status.textContent='Choose a screen, window, or tab in the browser permission prompt.';
      let stream=null,video=null;
      try{
        stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:1},audio:false});
        video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;video.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px';document.body.appendChild(video);
        await video.play();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const sw=video.videoWidth,sh=video.videoHeight;if(!sw||!sh)throw new Error('SCREEN_FRAME_UNAVAILABLE');
        const scale=Math.min(1,1280/sw,720/sh),width=Math.max(1,Math.round(sw*scale)),height=Math.max(1,Math.round(sh*scale));
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(video,0,0,width,height);
        const dataUrl=canvas.toDataURL('image/jpeg',0.6);stream.getTracks().forEach(t=>t.stop());stream=null;
        if(dataUrl.length>820000)throw new Error('SCREEN_CAPTURE_TOO_LARGE');
        const response=await originalFetch(captureEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({dataUrl,width,height})});
        if(!response.ok)throw new Error(response.status===413?'SCREEN_CAPTURE_TOO_LARGE':'SCREEN_CAPTURE_STORE_FAILED');
        const result=await response.json(),link=document.createElement('a');link.href=capturePreview;link.target='_blank';link.rel='noreferrer';link.textContent='Open latest capture';
        status.replaceChildren(document.createTextNode('Stored in local memory. '),link);
        send('browser.screen','info','User-approved screen capture stored locally: '+width+'x'+height+' ('+clean(result.id,80)+')');
      }catch(error){
        if(error?.name==='NotAllowedError'||error?.name==='AbortError')status.textContent='Capture cancelled. No image was stored.';
        else{const message=clean(error?.message||'Screen capture failed',160);status.textContent='Screen capture failed: '+message;send('browser.screen','error','Screen capture failed: '+message);}
      }finally{if(stream)stream.getTracks().forEach(t=>t.stop());if(video){video.srcObject=null;video.remove();}button.disabled=false;}
    });
    const install=()=>{if(document.body&&!document.getElementById(button.id))document.body.append(button,status);};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
    const open=XMLHttpRequest.prototype.open,sendXhr=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open=function(method,url,...args){this.__agentosDiagnosticPath=safePath(String(url));return open.call(this,method,url,...args);};
    XMLHttpRequest.prototype.send=function(...args){
      const xhr=this,path=xhr.__agentosDiagnosticPath||'unknown';
      if(path!==endpoint&&path!==captureEndpoint&&path!==capturePreview){
        xhr.addEventListener('loadend',()=>{if(xhr.status>=400)send('browser.network','error','HTTP '+xhr.status+' '+path);},{once:true});
        xhr.addEventListener('error',()=>send('browser.network','error','XHR failed '+path),{once:true});
        xhr.addEventListener('timeout',()=>send('browser.network','error','XHR timed out '+path),{once:true});
      }
      return sendXhr.apply(this,args);
    };
    window.fetch=async(...args)=>{
      const raw=args[0] instanceof Request?args[0].url:String(args[0]),path=safePath(raw);
      try{const response=await originalFetch(...args);if(!response.ok&&path!==endpoint&&path!==captureEndpoint&&path!==capturePreview)send('browser.network','error','HTTP '+response.status+' '+path);return response;}
      catch(error){if(path!==endpoint&&path!==captureEndpoint&&path!==capturePreview)send('browser.network','error','Fetch failed '+path+': '+(error?.message||'network error'));throw error;}
    };
  })();`;
}
