import axios from 'axios';
import { BaseAdapter } from './base.adapter.js';

class LocalLLMAdapter extends BaseAdapter {
    constructor(endpoint = 'http://localhost:19876') {
        super('local');
        this.endpoint = endpoint;
    }

    async generate(prompt, options = {}) {
        const res = await axios.post(`${this.endpoint}/api/generate`, {
            model:  options.model || 'llama3',
            prompt,
            stream: false
        });
        return { text: res.data.response, provider: 'local' };
    }
}

export default LocalLLMAdapter;
