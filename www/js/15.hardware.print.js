/* ==========================================================
   FILE: 15.hardware.print.js
   DESCRIPTION: Hardware Receipt Printer Integration
   ========================================================== */

const HardwarePrinter = {
    interfaces: [],
    currentInterface: 'none',

    initialize() {
        console.log('[Printer] Initializing hardware integration...');
        this.refreshPrinters();
    },

    refreshPrinters() {
        this.interfaces = [
            { id: 'none', name: 'Disable Printing' },
            { id: 'PRINTER_MAIN', name: 'Default Local Printer (Config)' }
        ];
        if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.printer) {
            cordova.plugins.printer.check((available) => {
                if (available) this.interfaces.push({ id: 'SYSTEM', name: 'System Print Dialog' });
                this.updateUI();
            });
        } else {
            this.updateUI();
        }
    },

    updateUI() {
        const select = document.getElementById('globalPrinterInterface');
        const label = document.getElementById('printerInterfaceLabel');
        if (!select) return;
        select.replaceChildren();
        this.interfaces.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.name;
            select.appendChild(option);
        });
        select.onchange = (e) => {
            this.currentInterface = e.target.value;
            if (label) label.textContent = `Interface: ${e.target.options[e.target.selectedIndex].text}`;
        };
    },

    _sanitizePrintHtml(contentHTML) {
        const source = String(contentHTML == null ? '' : contentHTML);
        const parser = new DOMParser();
        const parsed = parser.parseFromString(`<div id="print-root">${source}</div>`, 'text/html');
        const root = parsed.getElementById('print-root');
        if (!root) return '';
        root.querySelectorAll('script, iframe, object, embed, link, meta, style').forEach(node => node.remove());
        root.querySelectorAll('*').forEach(node => {
            Array.from(node.attributes).forEach(attr => {
                const name = attr.name.toLowerCase();
                const value = attr.value.trim();
                if (name.startsWith('on') || name === 'srcdoc' || (name === 'href' || name === 'src') && /^(?:javascript|data):/i.test(value)) {
                    node.removeAttribute(attr.name);
                }
            });
        });
        return root.innerHTML;
    },

    async printReceipt(contentHTML, title = 'Voucher Receipt') {
        if (this.currentInterface === 'none') {
            console.log('[Printer] Printing disabled. Ignoring request.');
            return false;
        }
        const safeContent = this._sanitizePrintHtml(contentHTML);
        const safeTitle = String(title == null ? 'Voucher Receipt' : title).slice(0, 120);
        console.log(`[Printer] Routing print job to ${this.currentInterface}...`);

        if (this.currentInterface === 'SYSTEM' && typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.printer) {
            return new Promise((resolve) => {
                cordova.plugins.printer.print(safeContent, { name: safeTitle }, () => resolve(true));
            });
        }

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            if (typeof showToast === 'function') showToast('Please allow popups to print', 'warning');
            return false;
        }

        const doc = printWindow.document;
        doc.replaceChildren();
        const html = doc.createElement('html');
        const head = doc.createElement('head');
        const titleEl = doc.createElement('title');
        titleEl.textContent = safeTitle;
        head.appendChild(titleEl);
        const body = doc.createElement('body');
        body.style.fontFamily = 'monospace';
        body.style.padding = '20px';
        const container = doc.createElement('div');
        // safeContent has passed the printer-specific allowlist above.
        container.innerHTML = safeContent;
        body.appendChild(container);
        html.append(head, body);
        doc.appendChild(html);
        printWindow.addEventListener('load', () => {
            printWindow.print();
            printWindow.close();
        }, { once: true });
        setTimeout(() => { try { printWindow.print(); printWindow.close(); } catch (_) {} }, 100);
        return true;
    },

    async testPrint() {
        const testHTML = '<div style="text-align:center;"><h2>br3eze.africa</h2><p>Hardware Printer Test</p><hr><p>Status: OK</p><p>' + new Date().toLocaleString() + '</p></div>';
        const success = await this.printReceipt(testHTML, 'Test Print');
        if (success && typeof showToast === 'function') showToast('Test print routed successfully.', 'success');
    }
};

window.HardwarePrinter = HardwarePrinter;
window.testPrinter = () => HardwarePrinter.testPrint();
window.refreshPrinters = () => HardwarePrinter.refreshPrinters();
