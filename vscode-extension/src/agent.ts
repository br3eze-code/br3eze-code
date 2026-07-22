export interface Br3ezeAgentOptions {
  gateway: string;
  apiKey: string | undefined;
}

export interface Br3ezeAgentRequest {
  domain: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface Br3ezeAgentResult {
  code: string;
}

export class Br3ezeAgent {
  constructor(private readonly options: Br3ezeAgentOptions) {}

  async execute(request: Br3ezeAgentRequest): Promise<Br3ezeAgentResult> {
    const response = await fetch(this.options.gateway, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {})
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(`Agent request failed: HTTP ${response.status}`);
    }

    return response.json() as Promise<Br3ezeAgentResult>;
  }
}
