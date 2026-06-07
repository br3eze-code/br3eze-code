/**
 * AIBridge Module
 * Handles integration with Gemini AI for the support chatbot and admin features.
 */

const AIBridge = {
    API_KEY: 'AIzaSyBHXTvmCGsppeT1b3R2vKD1pLOUS34Y4ZU',
    MODEL: 'gemini-2.5-flash',
    chatHistory: [],

    get URL() {
        return `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent?key=${this.API_KEY}`;
    },

    async getSystemContext() {
        const user = window.currentUser;
        let context = `You are 'Br3eze', a helpful support assistant for an Internet Hotspot service in Africa.
CURRENT USER DETAILS:
- Name: ${user ? user.fullname : 'Guest'}
- Username: ${user ? user.username : 'Guest'}
- Balance: $${user ? (user.credits || 0).toFixed(2) : '0.00'}
`;
        try {
            const plans = await DataStore.getPlans();
            if (plans.length > 0) {
                context += `\nAVAILABLE DATA PLANS (Sell these):`;
                plans.forEach(p => {
                    context += `\n- ${p.name}: $${p.price} (${p.durationValue || p.durationDays} ${p.durationUnit || 'days'}) - ${p.description}`;
                });
            }
        } catch (e) {
            console.error('AIBridge: Error fetching plans for context', e);
        }

        context += `\n\nGUIDELINES:
1. Keep answers short (under 3 sentences).
2. Be friendly and use emojis.
3. If they want to buy a plan, tell them to go to the "Plans" tab.
4. If they have connection issues, suggest they "forget the wifi network" and reconnect.
5. Never give out free credit.`;
        return context;
    },

    async sendMessage(message, onMessageReceived) {
        if (!message.trim()) return;

        try {
            const systemInstruction = await this.getSystemContext();
            const contents = [
                { role: "user", parts: [{ text: systemInstruction }] },
                ...this.chatHistory,
                { role: "user", parts: [{ text: message }] }
            ];

            const response = await fetch(this.URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: contents,
                    generationConfig: { temperature: 0.7, maxOutputTokens: 200 }
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error.message);

            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Pole, I didn't catch that.";
            
            // Update History
            this.chatHistory.push({ role: "user", parts: [{ text: message }] });
            this.chatHistory.push({ role: "model", parts: [{ text: reply }] });
            if (this.chatHistory.length > 10) this.chatHistory = this.chatHistory.slice(-10);

            if (onMessageReceived) onMessageReceived(reply);
            return reply;

        } catch (error) {
            console.error("AIBridge Error:", error);
            throw error;
        }
    }
};

window.AIBridge = AIBridge;
// For backward compatibility with app.js
window.sendChatMessage = async () => {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    // Call UI addMessage (expected to be global)
    if (window.addChatMessage) window.addChatMessage(message, 'user');

    try {
        await AIBridge.sendMessage(message, (reply) => {
            if (window.addChatMessage) window.addChatMessage(reply, 'bot');
        });
    } catch (e) {
        if (window.addChatMessage) window.addChatMessage("⚠️ Connection error. Please try again.", 'bot');
    }
};
