
const { SerialPort } = require('serialport');
const port = new SerialPort({ path: 'COM7', baudRate: 9600, autoOpen: false });

console.log('Attempting to open COM7...');
port.open((err) => {
    if (err) {
        console.error('FAILED to open port:', err.message);
        process.exit(1);
    }
    console.log('SUCCESS: Port opened');
    port.write('\x1b\x40Hello World\n\n\n\x1d\x56\x42\x00', (err) => {
        if (err) {
            console.error('FAILED to write:', err.message);
        } else {
            console.log('SUCCESS: Data written');
        }
        port.close(() => {
            console.log('Port closed');
            process.exit(0);
        });
    });
});
