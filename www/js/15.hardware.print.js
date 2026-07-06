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
        // Mocking available interfaces for now.
        // In a real Cordova env, you would query Bluetooth/USB printers using a plugin.
        this.interfaces = [
            { id: 'none', name: 'Disable Printing' },
            { id: 'PRINTER_MAIN', name: 'Default Local Printer (Config)' }
        ];
        
        if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.printer) {
            cordova.plugins.printer.check((available) => {
                if(available) {
                    this.interfaces.push({ id: 'SYSTEM', name: 'System Print Dialog' });
                }
                this.updateUI();
            });
        } else {
            this.updateUI();
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
