const net = require('net');

const targets = [
    '192.168.88.1',
    '192.168.1.1',
    '192.168.1.111',
    '192.168.1.51',
    '192.168.1.66',
    '192.168.1.253'
];

const ports = [8728, 8729, 80, 443, 22, 23, 8291];

async function checkPort(host, port, timeout = 1000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let status = 'CLOSED';

        socket.setTimeout(timeout);

        socket.on('connect', () => {
            status = 'OPEN';
            socket.destroy();
        });

        socket.on('timeout', () => {
            status = 'TIMEOUT';
            socket.destroy();
        });

        socket.on('error', () => {
            status = 'CLOSED';
        });

        socket.on('close', () => {
            resolve({ host, port, status });
        });

        socket.connect(port, host);
    });
}

async function run() {
    console.log('Starting comprehensive MikroTik port scan...');
    for (const host of targets) {
        console.log(`\nScanning ${host}:`);
        for (const port of ports) {
            const result = await checkPort(host, port);
            const color = result.status === 'OPEN' ? '\x1b[32m' : '\x1b[31m';
            console.log(`  Port ${port}: ${color}${result.status}\x1b[0m`);
        }
    }
}

run().catch(console.error);
