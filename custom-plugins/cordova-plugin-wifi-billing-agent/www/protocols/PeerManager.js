/**
 * PeerManager - Manages peer discovery and state
 */
var PeerManager = (function() {
    var peers = {};

    return {
        updatePeer: function(id, data) {
            peers[id] = data;
            peers[id].lastSeen = Date.now();
        },

        getPeer: function(id) {
            return peers[id];
        },

        getAllPeers: function() {
            return Object.values(peers);
        }
    };
})();

if (typeof window !== 'undefined') {
    window.PeerManager = PeerManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PeerManager;
}
