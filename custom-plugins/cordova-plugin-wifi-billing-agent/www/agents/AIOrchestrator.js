/**
 * AIOrchestrator - Processes natural language intents for agents
 */
var AIOrchestrator = (function() {
    return {
        process: function(input, context, success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'processIntent', [input, context]);
        }
    };
})();

if (typeof window !== 'undefined') {
    window.AIOrchestrator = AIOrchestrator;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIOrchestrator;
}
