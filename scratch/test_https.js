const https = require('https');
https.get('https://www.google.com', (res) => {
    console.log('Status Code:', res.statusCode);
    res.on('data', (d) => {
        console.log('Got data');
        process.exit(0);
    });
}).on('error', (e) => {
    console.error('Error:', e.message);
    process.exit(1);
});
setTimeout(() => { console.log('Timeout'); process.exit(1); }, 10000);
