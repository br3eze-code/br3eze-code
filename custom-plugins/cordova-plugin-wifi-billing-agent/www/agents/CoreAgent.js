/**
 * Core Agent - Central hub for the WiFi Billing Agent system
 */
var CoreAgent = (function() {
    var agents = {};
    var config = {};
    var eventBus = null;

    return {
        initialize: function(pluginConfig) {
            config = pluginConfig || {};
            console.log('CoreAgent: Initializing with config', config);
            
            // Register self
            this.registerAgent('core', this);
        },

        registerAgent: function(type, agent) {
            agents[type] = agent;
            console.log('CoreAgent: Registered agent', type);
        },

        getAgent: function(type) {
            return agents[type];
        },

        setEventBus: function(bus) {
            eventBus = bus;
        },

        emit: function(event, data) {
            if (eventBus) eventBus.emit(event, data);
        },

        on: function(event, callback) {
            if (eventBus) eventBus.on(event, callback);
        }
    };
})();

if (typeof window !== 'undefined') {
    window.CoreAgent = CoreAgent;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CoreAgent;
}
