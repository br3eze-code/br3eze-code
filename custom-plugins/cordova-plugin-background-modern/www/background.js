var exec = require('cordova/exec');

var listeners = {
    activate: [],
    deactivate: [],
    enable: [],
    disable: [],
    failure: []
};

var enabled = false;
var active = false;
var defaults = {
    title: 'Background service active',
    text: 'Background tasks are running for this app.'
};

function emit(event, payload) {
    (listeners[event] || []).slice().forEach(function (listener) {
        try { listener(payload); } catch (e) { setTimeout(function () { throw e; }, 0); }
    });
}

function on(event, callback) {
    if (listeners[event] && typeof callback === 'function') listeners[event].push(callback);
    return BackgroundModern;
}

function un(event, callback) {
    if (!listeners[event]) return BackgroundModern;
    if (!callback) {
        listeners[event] = [];
        return BackgroundModern;
    }
    listeners[event] = listeners[event].filter(function (listener) { return listener !== callback; });
    return BackgroundModern;
}

function start(success, error) {
    exec(function (result) {
        enabled = true;
        active = !!(result && result.active);
        emit('enable', result);
        if (success) success(result);
    }, function (failure) {
        enabled = false;
        emit('failure', failure);
        if (error) error(failure);
    }, 'BackgroundPlugin', 'start', []);
}

function stop(success, error) {
    exec(function (result) {
        enabled = false;
        active = false;
        emit('disable', result);
        if (success) success(result);
    }, error || function () {}, 'BackgroundPlugin', 'stop', []);
}

var BackgroundModern = {
    start: start,
    stop: stop,
    enable: start,
    disable: stop,
    setEnabled: function (value, success, error) {
        return value ? start(success, error) : stop(success, error);
    },
    status: function (success, error) {
        exec(function (result) {
            enabled = !!(result && result.enabled);
            active = !!(result && result.active);
            if (success) success(result);
        }, error || function () {}, 'BackgroundPlugin', 'status', []);
    },
    isEnabled: function (success, error) {
        this.status(success, error);
    },
    isActive: function (success, error) {
        this.status(function (result) {
            if (success) success(!!(result && result.active));
        }, error);
    },
    on: on,
    un: un,
    setDefaults: function (options) {
        if (options && typeof options === 'object') {
            Object.keys(options).forEach(function (key) { defaults[key] = options[key]; });
        }
        return BackgroundModern;
    },
    configure: function (options) {
        return this.setDefaults(options);
    },
    getDefaults: function () {
        return Object.assign({}, defaults);
    },
    _handlePause: function () {
        if (!enabled) return;
        active = true;
        emit('activate', { active: true, platform: 'cordova' });
    },
    _handleResume: function () {
        if (!enabled) return;
        active = false;
        emit('deactivate', { active: false, platform: 'cordova' });
    }
};

document.addEventListener('pause', function () { BackgroundModern._handlePause(); }, false);
document.addEventListener('resume', function () { BackgroundModern._handleResume(); }, false);

module.exports = BackgroundModern;
