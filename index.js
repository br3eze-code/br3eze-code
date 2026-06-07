const http = require('http');

const app = require('./interfaces/api.server');
const mikrotik = require('./agents/mikrotik.agent');

// start system
(async () => {
    await mikrotik.connect();

    http.createServer(app).listen(3000, () => {
        console.log('🚀 AgentOS running on port 3000');
    });

})();
