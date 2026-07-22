/**
 * VectorClock - Logical clocks for JavaScript consistency
 */
var VectorClock = function(nodeId) {
    this.nodeId = nodeId;
    this.versions = {};
    if (nodeId) this.versions[nodeId] = 0;
};

VectorClock.prototype.increment = function() {
    this.versions[this.nodeId] = (this.versions[this.nodeId] || 0) + 1;
};

VectorClock.prototype.merge = function(other) {
    for (var node in other.versions) {
        var remote = other.versions[node];
        var local = this.versions[node] || 0;
        this.versions[node] = Math.max(local, remote);
    }
};

VectorClock.prototype.toJSON = function() {
    return this.versions;
};

if (typeof window !== 'undefined') {
    window.VectorClock = VectorClock;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VectorClock;
}
