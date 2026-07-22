/**
 * AppData Module
 * Manages the global state of the application.
 */

const AppData = {
    currentUser: null,
    plans: [],
    network: { ssid: 'Br3eze-Hotspot', password: '' },
    isInitialized: false,

    async initialize(user) {
        this.currentUser = user;
        if (user) {
            // Load essential data in parallel
            const [plans, network] = await Promise.all([
                DataStore.getPlans(),
                DataStore.getNetworkSettings()
            ]);
            
            this.plans = plans;
            this.network = network;
            this.isInitialized = true;
            
            console.log('AppData: Initialized for', user.email);
            
            // Trigger UI updates
            window.dispatchEvent(new CustomEvent('appDataReady', { detail: { user, plans, network } }));
        } else {
            this.currentUser = null;
            this.isInitialized = false;
        }
    },

    getPlan(planId) {
        return this.plans.find(p => p.id === planId);
    }
};

window.AppData = AppData;
// Keep window.currentUser for backward compatibility with index.js
Object.defineProperty(window, 'currentUser', {
    get: () => AppData.currentUser,
    set: (val) => { AppData.currentUser = val; }
});
