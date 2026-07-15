import Anthropic from '@anthropic-ai/sdk';
import { BaseAdapter } from './base.adapter.js';

class ClaudeAdapter extends BaseAdapter {
    constructor(apiKey) {
        super('claude');
        this.client = new Anthropic({ apiKey });
    }

    async generate(prompt, options = {}) {
        const res = await this.client.messages.create({
            model:      options.model      || 'claude-sonnet-4-5',
            max_tokens: options.max_tokens || 1024,
            messages:   [{ role: 'user', content: prompt }]
        });
        return { text: res.content[0].text, provider: 'claude' };
    }

    async generateStream(prompt, options = {}) {
        return this.client.messages.stream({
            model:      options.model      || 'claude-sonnet-4-5',
            max_tokens: options.max_tokens || 1024,
            messages:   [{ role: 'user', content: prompt }]
        });
    }
}

export default ClaudeAdapter;
