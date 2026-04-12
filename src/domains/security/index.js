// src/domains/security/index.js
class SecurityDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'security';
    
    this.registerTool(new SecretTool());
    this.registerTool(new ScanTool());
    this.registerTool(new CertTool());
    this.registerTool(new IamTool());
  }
  
  async plan(intent) {
    switch (intent.action) {
      case 'rotate_secret':
        return {
          tool: 'secret',
          action: 'rotate',
          params: {
            name: intent.entities.secretName,
            notify: intent.entities.notifyServices || []
          }
        };
        
      case 'scan_vulnerabilities':
        return {
          tool: 'scan',
          action: 'vulnerabilityScan',
          params: {
            target: intent.entities.target,
            severity: intent.entities.severity || 'high',
            autoFix: intent.entities.autoFix || false
          }
        };
        
      case 'issue_cert':
        return {
          tool: 'cert',
          action: 'issue',
          params: {
            domain: intent.entities.domain,
            provider: intent.entities.provider || 'letsencrypt',
            wildcard: intent.entities.wildcard || false
          }
        };
    }
  }
}
