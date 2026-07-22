const net = require('net');

const targets = ['192.168.1.1', '192.168.1.111', '192.168.88.100', '192.168.1.253', '192.168.88.1'];
const ports = [8728, 8291, 80, 443];

async function check(host, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('error', () => {
            resolve(false);
        });
        socket.connect(port, host);
    });
}

async function run() {
    for (const host of targets) {
        console.log(`Checking ${host}...`);
        for (const port of ports) {
            const up = await check(host, port);
            if (up) {
                console.log(`  [+] Port ${port} is OPEN`);
            }
        }
    }
}

run();
