const net = require('net');

async function checkPort(host, port, timeout = 500) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);

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

async function scanSubnet() {
    const subnet = '192.168.1';
    const ports = [8728, 8291];
    console.log(`Scanning ${subnet}.0/24 for ports ${ports.join(', ')}...`);

    const checks = [];
    for (let i = 1; i < 255; i++) {
        const host = `${subnet}.${i}`;
        for (const port of ports) {
            checks.push(checkPort(host, port).then(isOpen => {
                if (isOpen) console.log(`[FOUND] ${host} has port ${port} OPEN`);
            }));
        }
    }

    await Promise.all(checks);
    console.log('Scan complete.');
}

scanSubnet().catch(console.error);
