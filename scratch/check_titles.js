const http = require('http');

const targets = [
    '192.168.1.1',
    '192.168.1.51',
    '192.168.1.66',
    '192.168.1.253'
];

async function getTitle(host) {
    return new Promise((resolve) => {
        const req = http.get(`http://${host}`, { timeout: 2000 }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const match = data.match(/<title>(.*?)<\/title>/i);
                resolve(match ? match[1] : 'No Title Found');
            });
        });

        req.on('error', () => resolve('Connection Error'));
        req.on('timeout', () => {
            req.destroy();
            resolve('Timeout');
        });
    });
}

async function run() {
    for (const host of targets) {
        const title = await getTitle(host);
        console.log(`${host}: ${title}`);
    }
}

run().catch(console.error);
