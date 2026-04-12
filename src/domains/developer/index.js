// src/domains/developer/index.js
class DeveloperDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'developer';
    
    this.registerTool(new CodeGenTool());
    this.registerTool(new GitTool());
    this.registerTool(new TestTool());
    this.registerTool(new BuildTool());
    this.registerTool(new LintTool());
  }
  
  async plan(intent) {
    switch (intent.action) {
      case 'generate_code':
        return {
          tool: 'codegen',
          action: 'generate',
          params: {
            description: intent.entities.description,
            language: intent.entities.language,
            framework: intent.entities.framework,
            tests: intent.entities.includeTests !== false
          }
        };
        
      case 'create_pr':
        return {
          tool: 'git',
          action: 'createPullRequest',
          params: {
            branch: intent.entities.branch,
            title: intent.entities.title,
            description: intent.entities.description,
            reviewers: intent.entities.reviewers
          }
        };
        
      case 'run_tests':
        return {
          tool: 'test',
          action: 'run',
          params: {
            suite: intent.entities.suite || 'all',
            coverage: intent.entities.coverage || true,
            parallel: intent.entities.parallel || false
          }
        };
    }
  }
}
