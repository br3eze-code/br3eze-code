import { diagnosticCaptureStore } from '../../core/diagnostics/diagnostic-capture-store.js';
import { diagnosticEventStore } from '../../core/diagnostics/diagnostic-store.js';
export function createBrowserObservationProvider({captureStore=diagnosticCaptureStore,eventStore=diagnosticEventStore,enabled=false}={}) {
  let active=enabled===true;
  return {
    setEnabled(value) { active=value===true; return active; },
    async getCapabilities() { return {screenCapture:active,notifications:active,browserNotifications:active,osNotifications:false}; },
    async captureScreen({context={}}={}) {
      if(!active)return {available:false,reason:'LOCAL_DIAGNOSTICS_DISABLED'};
      const capture=captureStore.getLatestMetadata({tenantId:context.tenantId||'local'});
      if(!capture)return {available:false,reason:'NO_USER_APPROVED_CAPTURE'};
      return {available:true,...capture,previewPath:'/__agentos/diagnostics/captures/latest'};
    },
    async readNotifications({context={},limit=20}={}) {
      if(!active)return {available:false,reason:'LOCAL_DIAGNOSTICS_DISABLED'};
      return eventStore.list({limit,source:'browser.notification',tenantId:context.tenantId||'local'});
    }
  };
}
export const browserObservationProvider=createBrowserObservationProvider();
