const net = require('net');

const targets = [
    '192.168.1.1',
    '192.168.1.51',
    '192.168.1.66',
    '192.168.1.253'
];

const ports = [8728, 8729, 8291, 80, 443, 22];

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
    for (const host of targets) {
        console.log(`\nScanning ${host}:`);
        for (const port of ports) {
            const result = await checkPort(host, port);
            if (result.status === 'OPEN') {
                console.log(`  Port ${port}: OPEN`);
            }
        }
    }
}

run().catch(console.error);
