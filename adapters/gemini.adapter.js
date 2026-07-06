'use strict';

const axios           = require('axios');
const { BaseAdapter } = require('./base.adapter');

class GeminiAdapter extends BaseAdapter {
    constructor(apiKey) {
        super('gemini');
        this.apiKey = apiKey;
    }

    async generate(prompt, options = {}) {
        const model = options.model || 'gemini-1.5-pro';
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
            { contents: [{ parts: [{ text: prompt }] }] }
        );
        return {
            text:     res.data.candidates?.[0]?.content?.parts?.[0]?.text || '',
            provider: 'gemini'
        };
    }
}

module.exports = GeminiAdapter;
