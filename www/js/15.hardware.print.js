/* ==========================================================
   FILE: 15.hardware.print.js
   DESCRIPTION: Hardware Receipt Printer Integration
   ========================================================== */

const HardwarePrinter = {
    interfaces: [],
    currentInterface: 'none',

    initialize() {
        console.log("[Printer] Initializing hardware integration...");
        this.refreshPrinters();
    },

    refreshPrinters() {
        this.interfaces = [
            { id: 'none', name: 'Disable Printing' },
            { id: 'PRINTER_MAIN', name: 'Default Local Printer (Config)' }
        ];

        const finish = () => this.updateUI();

        // Bluetooth Classic (SPP) paired printers via cordova-plugin-bluetooth-serial.
        // Most cheap thermal receipt printers pair over classic Bluetooth/SPP, not
        // BLE/GATT -- a BLE-only printer would need a separate plugin
        // (e.g. cordova-plugin-ble-central). USB printers aren't supported here at
        // all yet: no USB-serial Cordova plugin is installed in this project.
        if (typeof bluetoothSerial !== 'undefined') {
            bluetoothSerial.list((devices) => {
                (devices || []).forEach(d => {
                    this.interfaces.push({ id: `BT:${d.address}`, name: `🖨️ ${d.name || 'Unknown device'} (${d.address})` });
                });
                this._checkSystemPrint(finish);
            }, (err) => {
                console.warn('[Printer] Bluetooth paired-device list failed:', err);
                this._checkSystemPrint(finish);
            });
        } else {
            this._checkSystemPrint(finish);
        }
    },

    _checkSystemPrint(done) {
        if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.printer) {
            cordova.plugins.printer.check((available) => {
                if (available) this.interfaces.push({ id: 'SYSTEM', name: 'System Print Dialog' });
                done();
            });
        } else {
            done();
        }
    },

    updateUI() {
        const select = document.getElementById('globalPrinterInterface');
        const label = document.getElementById('printerInterfaceLabel');
        if (select) {
            select.innerHTML = this.interfaces.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
            select.onchange = (e) => {
                this.currentInterface = e.target.value;
                if (label) label.textContent = `Interface: ${e.target.options[e.target.selectedIndex].text}`;
            };
        }
    },

    async printReceipt(contentHTML, title = "Voucher Receipt") {
        if (this.currentInterface === 'none') {
            console.log("[Printer] Printing disabled. Ignoring request.");
            return false;
        }

        console.log(`[Printer] Routing print job to ${this.currentInterface}...`);

        if (this.currentInterface.startsWith('BT:')) {
            return this._printViaBluetooth(this.currentInterface.slice(3), contentHTML);
        }

        if (this.currentInterface === 'SYSTEM' && typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.printer) {
            return new Promise((resolve) => {
                cordova.plugins.printer.print(contentHTML, { name: title }, () => {
                    resolve(true);
                });
            });
        } else {
            // Fallback to browser print or mock interface
            const printWindow = window.open('', '_blank');
            if (printWindow) {
                printWindow.document.write(`
                    <html>
                    <head><title>${title}</title></head>
                    <body style="font-family: monospace; padding: 20px;">
                        ${contentHTML}
                        <script>window.print(); window.close();</script>
                    </body>
                    </html>
                `);
                printWindow.document.close();
            } else {
                if(typeof showToast === 'function') showToast('Please allow popups to print', 'warning');
            }
            return true;
        }
    },

    _htmlToReceiptText(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return (div.textContent || div.innerText || '')
            .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
    },

    async _printViaBluetooth(address, contentHTML) {
        if (typeof bluetoothSerial === 'undefined') {
            if (typeof showToast === 'function') showToast('Bluetooth printer plugin unavailable.', 'error');
            return false;
        }
        const text = this._htmlToReceiptText(contentHTML) + '\n\n\n';
        return new Promise((resolve) => {
            bluetoothSerial.connect(address, () => {
                bluetoothSerial.write(text, () => {
                    bluetoothSerial.disconnect();
                    resolve(true);
                }, (err) => {
                    console.error('[Printer] Bluetooth write failed:', err);
                    if (typeof showToast === 'function') showToast('Failed to send data to printer.', 'error');
                    bluetoothSerial.disconnect();
                    resolve(false);
                });
            }, (err) => {
                console.error('[Printer] Bluetooth connect failed:', err);
                if (typeof showToast === 'function') showToast('Could not connect to printer. Is it paired and powered on?', 'error');
                resolve(false);
            });
        });
    },

    async testPrint() {
        const testHTML = `
            <div style="text-align: center;">
                <h2>br3eze.africa</h2>
                <p>Hardware Printer Test</p>
                <hr>
                <p>Status: OK</p>
                <p>${new Date().toLocaleString()}</p>
            </div>
        `;
        const success = await this.printReceipt(testHTML, 'Test Print');
        if (success && typeof showToast === 'function') {
            showToast('Test print routed successfully.', 'success');
        }
    }
};

window.HardwarePrinter = HardwarePrinter;
window.testPrinter = () => HardwarePrinter.testPrint();
window.refreshPrinters = () => HardwarePrinter.refreshPrinters();
