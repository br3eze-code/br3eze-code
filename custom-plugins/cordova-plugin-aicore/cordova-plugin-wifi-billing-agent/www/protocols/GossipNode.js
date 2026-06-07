/**
 * GossipNode - JavaScript side of the gossip protocol
 */
var GossipNode = (function() {
    var core = null;

    return {
        initialize: function(coreAgent) {
            core = coreAgent;
            core.registerAgent('gossip', this);
        },

        getPeers: function(success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'getGossipPeers', []);
        },

        broadcast: function(type, payload, success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'gossipBroadcast', [type, payload]);
        },

        syncState: function(success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'syncBillingState', []);
        }
    };
})();

if (typeof window !== 'undefined') {
    window.GossipNode = GossipNode;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GossipNode;
}
