const net = require('net');

const targets = [
    { host: '192.168.1.1', port: 8728 },
    { host: '192.168.88.1', port: 8728 },
    { host: '192.168.1.111', port: 8728 }
];

async function checkPort(host, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const onError = () => {
            socket.destroy();
            resolve(false);
        };

        socket.setTimeout(2000);
        socket.on('error', onError);
        socket.on('timeout', onError);

        socket.connect(port, host, () => {
            socket.destroy();
            resolve(true);
        });
    });
}

async function run() {
    for (const target of targets) {
        console.log(`Checking ${target.host}:${target.port}...`);
        const open = await checkPort(target.host, target.port);
        console.log(`${target.host}:${target.port} is ${open ? 'OPEN' : 'CLOSED'}`);
    }
}

run();
