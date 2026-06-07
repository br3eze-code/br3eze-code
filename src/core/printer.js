const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;
const QRCode = require('qrcode');
const { execSync } = require('child_process');
const { logger } = require('./logger');
const { STATE_PATH } = require('./config');

/**
 * On Windows, Bluetooth serial printers appear as COM ports.
 * This helper parses paired BT devices to find the correct COM port
 * for the connected thermal printer (RFCOMM/SPP profile).
 *
 * If PRINTER_INTERFACE is explicitly set in .env (e.g. "\\\\.\\COM7"),
 * that value takes priority and discovery is skipped.
 *
 * @returns {string|null} COM port interface string e.g. "\\\\.\\COM7" or null
 */
let cachedBtPort = null;
let lastDiscoveryTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fast serial port discovery via Windows registry.
 * @returns {{ port: string, name: string, type: 'bluetooth'|'usb'|'serial', bus: string }}
 */
function _listSerialPortsFromRegistry() {
    const results = [];

    // Strategy 1: query SERIALCOMM which maps all active COM ports
    try {
        const raw = execSync(
            'reg query "HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM" 2>nul',
            { timeout: 2000, encoding: 'utf8', windowsHide: true }
        );
        
        // Regex to match: \Device\BthModem0    REG_SZ    COM7
        const regex = /([^\s]+)\s+REG_SZ\s+(COM\d+)/gi;
        let match;
        
        while ((match = regex.exec(raw)) !== null) {
            const devPath = match[1].toLowerCase();
            const comId = match[2].toUpperCase();

            let type = 'serial';
            let bus = 'unknown';

            if (devPath.includes('bth') || devPath.includes('bluetooth')) {
                type = 'bluetooth';
                bus = 'Bluetooth RFCOMM';
            } else if (devPath.includes('usb') || devPath.includes('usbser')) {
                type = 'usb';
                bus = 'USB Serial';
            } else if (devPath.includes('vcp')) {
                type = 'usb';
                bus = 'Virtual COM Port';
            } else if (devPath.includes('serial')) {
                type = 'serial';
                bus = 'Serial Port';
            }

            results.push({ port: comId, name: `${comId} (${bus})`, type, bus });
        }
        
        if (results.length > 0) return results;
    } catch (e) {
        logger.debug(`[Printer] SERIALCOMM registry query failed: ${e.message}`);
    }

    return results;
}

/**
 * List all available printer interfaces on the system.
 * Includes active COM ports and Windows Spooler printers.
 * @returns {Promise<Array<{id: string, name: string, type: 'serial'|'printer'|'tcp', bus?: string}>>}
 */
async function listAvailableInterfaces() {
    const interfaces = [];

    // 1. Add Spooler Printers (Windows only)
    if (process.platform === 'win32') {
        try {
            // Use PowerShell to get installed printers with status
            const raw = execSync(
                'powershell -Command "Get-Printer | Select-Object Name, PrinterStatus, JobCount | ConvertTo-Json"',
                { timeout: 5000, encoding: 'utf8', windowsHide: true }
            );
            if (raw.trim()) {
                let printers = JSON.parse(raw);
                if (!Array.isArray(printers)) printers = [printers];
                
                printers.forEach(p => {
                    if (p && p.Name) {
                        let statusText = 'unknown';
                        const s = p.PrinterStatus;
                        // Map common Windows status codes to simple terms
                        if (s === 1 || s === 3) statusText = 'online';
                        else if (s === 4 || s === 5) statusText = 'busy';
                        else if (s === 2 || s === 7 || s === 128) statusText = 'offline';
                        else if (s === 1024) statusText = 'printing';

                        interfaces.push({
                            id: `printer:${p.Name}`,
                            name: p.Name,
                            type: 'printer',
                            bus: 'Windows Spooler',
                            status: statusText,
                            jobs: p.JobCount || 0
                        });
                    }
                });
            }
        } catch (e) {
            logger.debug(`[Printer] Failed to list Windows printers: ${e.message}`);
        }
    }

    // 2. Add Serial Ports
    try {
        const serialPorts = _listSerialPortsFromRegistry();
        serialPorts.forEach(p => {
            interfaces.push({
                id: `serial:${p.port}`,
                name: p.name,
                type: 'serial',
                bus: p.bus
            });
        });
    } catch (e) {
        logger.debug(`[Printer] Failed to list serial ports: ${e.message}`);
    }

    // 3. Add default auto/network options if none found
    if (interfaces.length === 0) {
        interfaces.push({ id: 'auto', name: 'Auto Discover', type: 'serial' });
    }

    return interfaces;
}


/**
 * Discover a thermal printer port automatically.
 * Priority: Bluetooth COM port → USB COM port → null
 * Returns a node-thermal-printer compatible interface string.
 * Results are cached for CACHE_TTL to avoid repeated shell calls.
 *
 * @param {string} [preferredType='any'] - 'ble', 'usb', or 'any'
 * @returns {string|null}
 */
function discoverPrinterPort(preferredType = 'any', retries = 1) {
    const now = Date.now();
    // Use cache if it exists and we're not asking for a specific type different from what might be cached,
    // though for simplicity we just return cached if we're in 'any' mode or if we accept the risk.
    if (cachedBtPort && (now - lastDiscoveryTime < CACHE_TTL) && preferredType === 'any') {
        logger.debug(`[Printer] Using cached printer port: ${cachedBtPort}`);
        return cachedBtPort;
    }

    let attempts = 0;
    while (attempts <= retries) {
        // ── 1. Try Bluetooth serial ports ────────────────────────────────────────
        if (preferredType === 'any' || preferredType === 'ble') {
            try {
                const availablePorts = _listSerialPortsFromRegistry();
                const blacklist = ['COM1', 'COM11', 'LPT1'];
                const portsToProbe = availablePorts.filter(p => !blacklist.includes(p.port.toUpperCase()));

                for (const p of portsToProbe.filter(port => port.type === 'bluetooth')) {
                    try {
                        execSync(`powershell -Command "try { $p = New-Object System.IO.Ports.SerialPort '${p.port}', 9600; $p.Open(); $p.Close(); exit 0 } catch { exit 1 }"`, { timeout: 2000, windowsHide: true });
                        const iface = _comPortToInterface(p.port);
                        cachedBtPort = iface;
                        lastDiscoveryTime = now;
                        logger.info(`[Printer] Auto-discovered Bluetooth printer on ${iface} (${p.name})`);
                        return iface;
                    } catch (e) {
                        logger.debug(`[Printer] Bluetooth port ${p.port} is not accessible: ${e.message}`);
                        continue;
                    }
                }
            } catch (e) {
                logger.warn(`[Printer] Bluetooth discovery failed: ${e.message}`);
            }
        }

        // ── 2. Try USB serial printers ────────────────────────────────────────────
        if (preferredType === 'any' || preferredType === 'usb') {
            try {
                const ports = _listSerialPortsFromRegistry();
                const blacklist = ['COM1', 'COM11', 'LPT1'];
                for (const p of ports.filter(port => port.type === 'usb' && !blacklist.includes(port.port.toUpperCase()))) {
                    try {
                        execSync(`powershell -Command "try { $p = New-Object System.IO.Ports.SerialPort '${p.port}', 9600; $p.Open(); $p.Close(); exit 0 } catch { exit 1 }"`, { timeout: 2000, windowsHide: true });

                        const iface = _comPortToInterface(p.port);
                        cachedBtPort = iface;
                        lastDiscoveryTime = now;
                        logger.info(`[Printer] Auto-discovered USB printer on ${iface} (${p.bus})`);
                        return iface;
                    } catch (e) {
                        logger.debug(`[Printer] USB port ${p.port} is not accessible: ${e.message}`);
                        continue;
                    }
                }
            } catch (e) {
                logger.warn(`[Printer] USB serial discovery failed: ${e.message}`);
            }
        }

        attempts++;
        if (attempts <= retries) {
            logger.debug(`[Printer] No printer found, retrying in 1s... (Attempt ${attempts}/${retries})`);
            // Synchronous sleep since this is usually called from CLI actions
            const start = Date.now();
            while (Date.now() - start < 1000) { /* wait */ }
        }
    }

    logger.debug(`[Printer] No ${preferredType} printer COM port auto-discovered after ${retries + 1} attempts.`);
    return null;
}

// Keep old export name for backward compatibility
const discoverBluetoothPrinterPort = discoverPrinterPort;

/** Convert a raw COM port ID (e.g. "COM7") to a node-thermal-printer interface string */
function _comPortToInterface(deviceID) {
    const portNum = parseInt(deviceID.replace(/^COM/i, ''), 10);
    // Always use \\.\COMx format — required for all ports on Windows with node-thermal-printer
    return `serial:\\\\.\\COM${portNum}`;
}

async function _printVoucherDirect(voucherData, printerId = 'PRINTER_MAIN', _triedInterfaces = []) {
    const { getConfig } = require('./config');
    const config = getConfig();

    // ── Field validation: guard against raw DB objects being passed directly ──
    // printVoucher expects { username, password, profile, loginUrl }.
    // If the caller passed a raw DB voucher (which uses `id`, `plan`, etc.)
    // we surface a clear error instead of crashing inside QR/buffer generation.
    if (!voucherData?.username) {
        const msg = `printVoucher called with missing 'username' — did you pass a raw DB voucher? ` +
            `Use printExistingVoucher() or map { username, password, profile, loginUrl } first.`;
        logger.error(`[Printer] ❌ ${msg}`);
        return { success: false, error: msg };
    }

    const { username, password, profile } = voucherData;
    // Fallback loginUrl so QR generation never crashes on undefined
    const loginUrl = voucherData.loginUrl ||
        `http://${config.mikrotik?.ip || config.adapters?.mikrotik?.host || '192.168.88.1'}/login.html?code=${username}`;

    // Check specific printer enabled flag if it exists, otherwise fall back to global
    const printerEnabledStr = process.env[`${printerId}_ENABLED`];
    const isPrinterEnabled = printerEnabledStr ? printerEnabledStr !== 'false' : config.printer?.enabled !== false;

    if (!isPrinterEnabled) {
        logger.info(`[Printer] Printing disabled for ${printerId} — skipping.`);
        return { success: false, error: 'Printer disabled in configuration.' };
    }

    let iface = printerId;
    let serialHandle = null;

    try {
        // If printerId looks like a direct interface (e.g. 'printer:NAME' or 'COM1'), use it directly
        if (printerId && (printerId.includes(':') || /^COM\d+$/i.test(printerId))) {
            iface = printerId;
        } else {
            // Priority: explicit printerId env > global explicit > auto-discover > TCP fallback
            iface = process.env[`${printerId}_INTERFACE`] || config.printer?.interface || 'auto';
        }

        // Check if user explicitly wants auto-discovery for a specific bus
        const isAutoBLE = iface === 'ble://' || iface === 'ble';
        const isAutoUSB = iface === 'usb://' || iface === 'usb';
        const isAutoAny = iface === 'auto' || iface === 'tcp://192.168.88.254';

        if (isAutoBLE || isAutoUSB || isAutoAny) {
            const preferredType = isAutoBLE ? 'ble' : (isAutoUSB ? 'usb' : 'any');
            const discovered = discoverPrinterPort(preferredType);
            if (discovered) {
                iface = discovered;
            } else {
                // Last resort: TCP default
                iface = 'tcp://192.168.88.254';
            }
        } else {
            // Strip pseudo-protocols if a port was actually provided (e.g. ble://COM7)
            if (/^ble:\/\//i.test(iface)) iface = iface.replace(/^ble:\/\//i, '');
            if (/^usb:\/\//i.test(iface)) iface = iface.replace(/^usb:\/\//i, '');

            // Normalise bare COMx or serial:COMx → serial:\\.\COMx so node-thermal-printer resolves correctly
            if (/^COM\d+$/i.test(iface)) {
                iface = _comPortToInterface(iface);
            } else if (/^serial:COM\d+$/i.test(iface)) {
                iface = _comPortToInterface(iface.replace('serial:', ''));
            }
        }

        const printerTypeStr = process.env[`${printerId}_TYPE`] || config.printer?.type || 'EPSON';
        const printerModel = process.env[`${printerId}_MODEL`] || config.printer?.model || 'generic';

        // Handle specific models mentioned by user
        let printerWidth = config.printer?.width || 80;
        let charSet = 'PC858_EURO';

        if (printerModel.toLowerCase().includes('58') || printerModel.toLowerCase() === 'pos-58c') {
            printerWidth = 58;
            charSet = 'PC437_USA'; // Many 58mm clones prefer this
            logger.debug(`[Printer] Applying POS-58C profile (58mm, PC437)`);
        } else if (printerModel.toLowerCase().includes('88') || printerModel.toLowerCase() === 'tmv88') {
            printerWidth = 80;
            charSet = 'PC858_EURO';
            logger.debug(`[Printer] Applying TMV88 profile (80mm, PC858)`);
        }

        const printerType = printerTypeStr === 'STAR' ? PrinterTypes.STAR : PrinterTypes.EPSON;

        const printerConfig = {
            type: printerType,
            interface: iface,
            characterSet: charSet,
            width: printerWidth,
            options: { timeout: config.printer?.timeout || 5000 }
        };

        const isWindowsRawGen = iface.startsWith('printer:') || iface.startsWith('serial:');
        if (isWindowsRawGen) {
            // We use a dummy interface for node-thermal-printer so it generates the buffer
            // but we will manually send the buffer to PowerShell later.
            printerConfig.interface = 'printer:dummy';
            // node-thermal-printer strictly checks `if (moduleName && typeof moduleName === 'object')`
            // and throws "No driver set!" if we don't provide a dummy object.
            printerConfig.driver = {
                getPrinters: () => [],
                getPrinter: () => ({ status: 'AVAILABLE' }),
                printDirect: () => { }, // We will never call this
                isPrinterConnected: () => Promise.resolve(true)
            };
        }

        logger.info(`[Printer] Initializing ${printerModel} (${printerWidth}mm). Interface: ${iface}, Type: ${printerTypeStr}`);

        const printer = new ThermalPrinter(printerConfig);
        // Keep a reference to the underlying SerialPort so we can force-close it
        // if execute() fails — prevents the process from hanging on open COM handles
        if (iface.startsWith('serial:')) {
            try {
                const { SerialPort } = require('serialport');
                serialHandle = new SerialPort({ path: iface.replace('serial:', ''), baudRate: 9600, autoOpen: false });
            } catch (_) { /* serialport not available, skip */ }
        }

        // ── Connection Check with Timeout ───────────────────────────────────────────
        let isConnected = false;
        try {
            logger.debug('[Printer] Checking if printer is connected...');
            // Wrap in 2s timeout — Bluetooth COM ports on Windows often hang on open
            isConnected = await Promise.race([
                printer.isPrinterConnected(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
            ]).catch(() => false);
        } catch (e) {
            logger.debug(`[Printer] Connection check failed/timed out: ${e.message}`);
            isConnected = false;
        }

        logger.info(`[Printer] Connection status: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`);

        if (!isConnected) {
            logger.warn('[Printer] Printer not responding to connection check — attempting print anyway (some BT drivers report false).');
        }

        // ── Build premium voucher receipt ───────────────────────────────────────────────
        const { BRAND } = require('./config');

        printer.alignCenter();
        printer.setTextSize(1, 1);
        printer.bold(true);
        printer.println(`${BRAND.emoji} ${BRAND.name.toUpperCase()} ${BRAND.emoji}`);
        printer.bold(false);
        printer.setTextNormal();
        printer.println(BRAND.tagline);
        printer.newLine();
        printer.println('WIFI ACCESS VOUCHER');
        printer.newLine();

        printer.setTextNormal();
        if (printerWidth === 58) {
            printer.setTextSize(0, 0); // Smaller text for 58mm
        } else {
            printer.setTextSize(1, 1);
        }

        printer.invert(true);
        printer.println(`  CODE: ${username}  `);
        printer.invert(false);
        printer.setTextNormal();
        printer.newLine();

        printer.leftRight('Plan:', profile);
        if (voucherData.duration) {
            printer.leftRight('Duration:', voucherData.duration);
        }
        if (voucherData.expires) {
            printer.leftRight('Expires:', new Date(voucherData.expires).toLocaleDateString());
        }
        if (voucherData.price) {
            printer.leftRight('Price:', `${voucherData.currency || '$'}${Number(voucherData.price).toFixed(2)}`);
        }
        if (voucherData.status && voucherData.status !== 'active' && voucherData.status !== 'unused') {
            printer.leftRight('Status:', voucherData.status.toUpperCase());
        }
        printer.drawLine();

        printer.alignCenter();
        printer.println('SCAN TO CONNECT');

        // POS-58 generic printers often do not support native ESC/POS QR commands (GS ( k)
        // Instead of printer.printQR(), we generate a PNG raster image and print it.
        try {
            const qrWidth = printerWidth === 58 ? 200 : 250;
            const qrBuffer = await QRCode.toBuffer(loginUrl, { 
                type: 'png', 
                width: qrWidth, 
                margin: 2, 
                errorCorrectionLevel: 'M' 
            });
            await printer.printImageBuffer(qrBuffer);
        } catch (qrErr) {
            logger.error(`[Printer] Failed to generate QR raster image: ${qrErr.message}`);
            // Fallback to native ESC/POS QR command if image generation fails
            const qrSize = printerWidth === 58 ? 4 : 6;
            printer.printQR(loginUrl, { cellSize: qrSize, correction: 'M', model: 2 });
        }

        printer.newLine();
        if (config.support?.phone || config.support?.email) {
            printer.println('Need help? Contact support:');
            if (config.support.phone) printer.println(config.support.phone);
            if (config.support.email) printer.println(config.support.email);
            printer.newLine();
        }
        printer.println('Thank you for choosing us!');
        printer.println(new Date().toLocaleString());
        printer.println('------------------------------');
        printer.cut();

        logger.debug(`[Printer] Executing print job for user: ${username}`);

        const isWindowsRaw = process.platform === 'win32' && (iface.startsWith('printer:') || iface.startsWith('serial:'));

        if (isWindowsRaw) {
            const isSpooler = iface.startsWith('printer:');
            const rawTarget = isSpooler ? iface.replace('printer:', '') : iface.replace('serial:', '');
            // Extract COMxx in JS so PowerShell receives a clean port name (e.g. COM11 instead of \\.\COM11)
            const _comMatch = rawTarget.match(/COM(\d+)/i);
            const serialPortName = _comMatch ? `COM${_comMatch[1]}` : rawTarget.replace(/[^a-zA-Z0-9]/g, '');
            logger.debug(`[Printer] Delivery target: ${rawTarget} -> Cleaned: ${serialPortName}`);
            const buffer = printer.getBuffer();
            const fs = require('fs');
            const path = require('path');
            const { execSync } = require('child_process');

            const tempFile = path.join(STATE_PATH, `print_${Date.now()}.bin`);
            const scriptFile = path.join(STATE_PATH, `print_${Date.now()}.ps1`);

            try {
                fs.writeFileSync(tempFile, buffer);
                const psScript = `
$ErrorActionPreference = "Stop"
$p = "${rawTarget}"
$f = "${tempFile.replace(/\\/g, '\\\\')}"
$isSpooler = ${isSpooler ? '$true' : '$false'}

if ($isSpooler) {
    try {
        $code = @"
        using System;
        using System.Runtime.InteropServices;
        public class RawPrintV5 {
            [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
            public struct DOC_INFO_1 {
                [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
                [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
                [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
            }
            [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
            public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
            [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
            public static extern bool ClosePrinter(IntPtr hPrinter);
            [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
            public static extern uint StartDocPrinter(IntPtr hPrinter, uint level, [In] ref DOC_INFO_1 di);
            [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
            public static extern bool EndDocPrinter(IntPtr hPrinter);
            [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
            public static extern bool StartPagePrinter(IntPtr hPrinter);
            [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
            public static extern bool EndPagePrinter(IntPtr hPrinter);
            [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
            public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, uint dwCount, out uint dwWritten);
        }
"@
        if (-not ([System.Management.Automation.PSTypeName]"RawPrintV5").Type) { Add-Type -TypeDefinition $code }
        $h = [IntPtr]::Zero
        $di = New-Object RawPrintV5+DOC_INFO_1
        $di.pDocName = "AgentOS Voucher"
        $di.pDatatype = "RAW"
        $targetPrinter = $p.Trim()
        
        if ([RawPrintV5]::OpenPrinter($targetPrinter, [ref]$h, [IntPtr]::Zero)) {
            try {
                $docId = [RawPrintV5]::StartDocPrinter($h, 1, [ref]$di)
                if ($docId -eq 0) {
                    $di.pDatatype = $null
                    $docId = [RawPrintV5]::StartDocPrinter($h, 1, [ref]$di)
                }
                
                if ($docId -ne 0) {
                    if ([RawPrintV5]::StartPagePrinter($h)) {
                        $b = [System.IO.File]::ReadAllBytes($f)
                        $ptr = [System.Runtime.InteropServices.Marshal]::AllocCoTaskMem($b.Length)
                        [System.Runtime.InteropServices.Marshal]::Copy($b, 0, $ptr, $b.Length)
                        $written = 0
                        if ([RawPrintV5]::WritePrinter($h, $ptr, $b.Length, [ref]$written)) {
                            [RawPrintV5]::EndPagePrinter($h)
                            [RawPrintV5]::EndDocPrinter($h)
                            Write-Host "SUCCESS: Sent $written bytes to spooler '$p'"
                        } else { 
                            throw "WritePrinter failed" 
                        }
                        [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($ptr)
                    } else { 
                        throw "StartPagePrinter failed" 
                    }
                } else {
                    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
                    throw "StartDocPrinter failed (Win32 Error: $err)"
                }
            } finally {
                [RawPrintV5]::ClosePrinter($h)
            }
        } else {
            $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
            throw "OpenPrinter failed (Win32 Error: $err). Check if printer '$p' is installed."
        }
    } catch {
        Write-Host "ERROR: $($_.Exception.Message)"
        exit 1
    }
} else {
    # Direct Serial Printing
    try {
        $portName = "${serialPortName}"
        $port = New-Object System.IO.Ports.SerialPort $portName, 9600, None, 8, one
        $port.WriteTimeout = 5000
        $port.DtrEnable = $true
        $port.RtsEnable = $true
        try {
            $port.Open()
        } catch {
             Write-Host "ERROR: Failed to open $portName. Make sure the printer is turned on and connected. ($($_.Exception.Message))"
             exit 1
        }
        $wake = [byte[]]@(0x00, 0x1B, 0x40)
        $port.Write($wake, 0, $wake.Length)
        Start-Sleep -Milliseconds 500
        $b = [System.IO.File]::ReadAllBytes($f)
        $port.Write($b, 0, $b.Length)
        Start-Sleep -Milliseconds 500
        $port.Close()
        Write-Host "SUCCESS: Sent $($b.Length) bytes to serial port '$portName'"
    } catch {
        Write-Host "ERROR: Serial port '$p' failed - $($_.Exception.Message)"
        exit 1
    }
}
`;
                fs.writeFileSync(scriptFile, psScript);
                logger.debug(`[Printer] Delivering bytes to "${rawTarget}" via PowerShell ${isSpooler ? 'Win32 API' : 'Serial Stream'}...`);
                
                let output;
                try {
                    output = execSync(`powershell -ExecutionPolicy Bypass -File "${scriptFile}"`, { windowsHide: true, stdio: 'pipe' });
                } catch (execError) {
                    // execSync throws if exit code is non-zero
                    const stdout = execError.stdout ? execError.stdout.toString().trim() : '';
                    const stderr = execError.stderr ? execError.stderr.toString().trim() : '';
                    const errText = stdout || stderr || execError.message;
                    throw new Error(errText);
                }

                const result = output.toString().trim();
                if (result.includes('SUCCESS')) {
                    logger.info(`[Printer] ${result}`);
                } else {
                    throw new Error(result || 'Unknown PowerShell error');
                }
            } catch (psError) {
                logger.error(`[Printer] Print execution failed: ${psError.message}`);
                throw psError;
            } finally {
                if (fs.existsSync(tempFile)) try { fs.unlinkSync(tempFile); } catch (e) { }
                if (fs.existsSync(scriptFile)) try { fs.unlinkSync(scriptFile); } catch (e) { }
            }
        } else {
            await printer.execute();
        }

        logger.info(`[Printer] ✅ Voucher printed successfully for ${username} via ${iface}`);

        const qrDataURI = await QRCode.toDataURL(loginUrl);
        return { success: true, qrDataURI, interface: iface };

    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[Printer] ❌ Error printing voucher for ${voucherData?.username} via ${iface}: ${errorMsg}`);
        
        // --- Fallback Logic ---
        _triedInterfaces.push(iface);
        if (_triedInterfaces.length < 3) {
            try {
                logger.info(`[Printer] Attempting fallback to another available printer...`);
                const available = await module.exports.listAvailableInterfaces();
                
                // Filter to only Windows spoolers (usb/network printers that are installed)
                // Also exclude any interfaces we've already tried in this chain
                const fallbackCandidates = available.filter(p => p.type === 'printer' && !_triedInterfaces.includes(p.id));
                
                if (fallbackCandidates.length > 0) {
                    // Sort to prioritize physical thermal printers over virtual ones (PDF, OneNote, XPS, etc.)
                    fallbackCandidates.sort((a, b) => {
                        const aName = a.name.toLowerCase();
                        const bName = b.name.toLowerCase();
                        const isAThermal = aName.includes('pos') || aName.includes('thermal') || aName.includes('receipt');
                        const isBThermal = bName.includes('pos') || bName.includes('thermal') || bName.includes('receipt');
                        const isAVirtual = aName.includes('pdf') || aName.includes('onenote') || aName.includes('xps');
                        const isBVirtual = bName.includes('pdf') || bName.includes('onenote') || bName.includes('xps');

                        let aScore = (isAThermal ? 10 : 0) - (isAVirtual ? 10 : 0);
                        let bScore = (isBThermal ? 10 : 0) - (isBVirtual ? 10 : 0);
                        return bScore - aScore; // Descending order
                    });

                    const nextInterface = fallbackCandidates[0].id;
                    logger.info(`[Printer] Found fallback printer: ${nextInterface}`);
                    // Ensure the fallback clears out any previously open handles
                    try { printer.clearData(); } catch (_) {}
                    if (serialHandle && serialHandle.isOpen) {
                        try { serialHandle.close(); } catch (_) {}
                    }
                    return await _printVoucherDirect(voucherData, nextInterface, _triedInterfaces);
                } else {
                    logger.warn(`[Printer] No suitable fallback printers found.`);
                }
            } catch (fallbackError) {
                logger.error(`[Printer] Fallback logic failed: ${fallbackError.message}`);
            }
        }
        // --- End Fallback Logic ---

        logger.debug(`[Printer] Stack trace: ${e?.stack || 'No stack trace available'}`);
        if (e?.code) logger.error(`[Printer] Error code: ${e.code}`);
        return {
            success: false,
            error: errorMsg,
            code: e?.code,
            stack: e?.stack
        };
    } finally {
        // Force-close any open COM port handle to prevent process hang
        try { printer.clearData(); } catch (_) { }
        if (serialHandle) {
            try {
                if (serialHandle.isOpen) serialHandle.close();
            } catch (_) { }
        }
    }
}

async function testPrinterConnection(printerConfig = {}) {
    let iface = printerConfig.interface || 'auto';
    const isAutoBLE = iface === 'ble://' || iface === 'ble';
    const isAutoUSB = iface === 'usb://' || iface === 'usb';
    const isAutoAny = iface === 'auto' || iface === 'tcp://192.168.88.254';

    let portSource = 'configured';
    let portDiscovered = false;

    if (isAutoBLE || isAutoUSB || isAutoAny) {
        const preferredType = isAutoBLE ? 'ble' : (isAutoUSB ? 'usb' : 'any');
        const discovered = discoverPrinterPort(preferredType);
        if (discovered) {
            iface = discovered;
            portSource = 'discovered';
            portDiscovered = true;
        } else {
            iface = 'tcp://192.168.88.254';
            portSource = 'fallback';
        }
    } else {
        if (/^ble:\/\//i.test(iface)) iface = iface.replace(/^ble:\/\//i, '');
        if (/^usb:\/\//i.test(iface)) iface = iface.replace(/^usb:\/\//i, '');
        if (/^COM\d+$/i.test(iface)) iface = _comPortToInterface(iface);
        else if (/^serial:COM\d+$/i.test(iface)) iface = _comPortToInterface(iface.replace('serial:', ''));
    }

    const printerType = printerConfig.type === 'STAR' ? PrinterTypes.STAR : PrinterTypes.EPSON;
    const config = {
        type: printerType,
        interface: iface,
        characterSet: printerConfig.characterSet || 'PC437_USA', // Safe default to prevent beeping
        options: { timeout: printerConfig.timeout || 5000 }
    };

    try {
        // Distinguish between Busy and Offline on Windows Serial ports
        if (iface.startsWith('serial:')) {
            const { SerialPort } = require('serialport');
            const portPath = iface.replace('serial:', '');
            const testPort = new SerialPort({ path: portPath, baudRate: 9600, autoOpen: false });

            await new Promise((resolve, reject) => {
                testPort.open((err) => {
                    if (err) {
                        if (err.message.includes('Access denied') || err.message.includes('EBUSY')) {
                            reject(new Error('Access denied'));
                        } else {
                            reject(err);
                        }
                    } else {
                        testPort.close(() => resolve());
                    }
                });
            });
        }

        const printer = new ThermalPrinter(config);
        const isConnected = await printer.isPrinterConnected();

        if (isConnected) {
            return { success: true, port: iface, portSource, portDiscovered, message: 'Connected' };
        }

        // Port discovered but device not responding (e.g. powered off / out of range)
        if (portDiscovered) {
            return {
                success: false,
                port: iface,
                portSource,
                portDiscovered,
                message: `Port found (${iface}) but printer not responding — check power/range`
            };
        }

        return {
            success: false,
            port: iface,
            portSource,
            portDiscovered,
            message: portSource === 'fallback'
                ? 'No COM port detected — TCP fallback unreachable'
                : 'Disconnected'
        };
    } catch (e) {
        const msg = e.message || String(e);
        if (msg.includes('Access denied') || msg.includes('EBUSY')) {
            return {
                success: true,
                port: iface,
                portSource,
                portDiscovered,
                message: 'Active (Port Busy / Access Denied). Password default is 0000'
            };
        }
        return { success: false, port: iface, portSource, portDiscovered, message: msg };
    }
}

async function printRaw(buffer, printerConfig = {}) {
    let iface = printerConfig.interface || 'auto';
    if (iface === 'auto') {
        iface = discoverPrinterPort('any') || 'tcp://192.168.88.254';
    }

    const isWindowsRaw = process.platform === 'win32' && (iface.startsWith('printer:') || iface.startsWith('serial:'));
    if (isWindowsRaw) {
        const isSpooler = iface.startsWith('printer:');
        const rawTarget = isSpooler ? iface.replace('printer:', '') : iface.replace('serial:', '');
        const _comMatch = rawTarget.match(/COM(\d+)/i);
        const serialPortName = _comMatch ? `COM${_comMatch[1]}` : rawTarget.replace(/[^a-zA-Z0-9]/g, '');
        const fs = require('fs');
        const path = require('path');
        const { execSync } = require('child_process');

        const tempFile = path.join(STATE_PATH, `print_raw_${Date.now()}.bin`);
        const scriptFile = path.join(STATE_PATH, `print_raw_${Date.now()}.ps1`);

        try {
            fs.writeFileSync(tempFile, buffer);
            const psScript = `
$p = "${rawTarget}"
$f = "${tempFile.replace(/\\/g, '\\\\')}"
$isSpooler = ${isSpooler ? '$true' : '$false'}

if ($isSpooler) {
    $code = @"
    using System;
    using System.Runtime.InteropServices;
    public class RawPrintV5 {
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
        public struct DOC_INFO_1 {
            [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
            [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
            [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
        }
        [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
        public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
        [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
        public static extern bool ClosePrinter(IntPtr hPrinter);
        [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
        public static extern uint StartDocPrinter(IntPtr hPrinter, uint level, [In] ref DOC_INFO_1 di);
        [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
        public static extern bool EndDocPrinter(IntPtr hPrinter);
        [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
        public static extern bool StartPagePrinter(IntPtr hPrinter);
        [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
        public static extern bool EndPagePrinter(IntPtr hPrinter);
        [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
        public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, uint dwCount, out uint dwWritten);
    }
"@
    if (-not ([System.Management.Automation.PSTypeName]"RawPrintV5").Type) { Add-Type -TypeDefinition $code }
    $h = [IntPtr]::Zero
    $di = New-Object RawPrintV5+DOC_INFO_1
    $di.pDocName = "AgentOS Print Job"
    $di.pDatatype = "RAW"
    $targetPrinter = $p.Trim()
    if ([RawPrintV5]::OpenPrinter($targetPrinter, [ref]$h, [IntPtr]::Zero)) {
        $docId = [RawPrintV5]::StartDocPrinter($h, 1, [ref]$di)
        if ($docId -eq 0) {
            $di.pDatatype = $null
            $docId = [RawPrintV5]::StartDocPrinter($h, 1, [ref]$di)
        }
        
        if ($docId -ne 0) {
            if ([RawPrintV5]::StartPagePrinter($h)) {
                $b = [System.IO.File]::ReadAllBytes($f)
                $ptr = [System.Runtime.InteropServices.Marshal]::AllocCoTaskMem($b.Length)
                [System.Runtime.InteropServices.Marshal]::Copy($b, 0, $ptr, $b.Length)
                $written = 0
                if ([RawPrintV5]::WritePrinter($h, $ptr, $b.Length, [ref]$written)) {
                    [RawPrintV5]::EndPagePrinter($h)
                    [RawPrintV5]::EndDocPrinter($h)
                    Write-Host "SUCCESS: Sent $written bytes to spooler '$p'"
                } else { Write-Host "ERROR: WritePrinter failed"; exit 1 }
                [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($ptr)
            } else { Write-Host "ERROR: StartPagePrinter failed"; exit 1 }
            [RawPrintV5]::ClosePrinter($h)
        } else { 
            $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
            Write-Host "ERROR: StartDocPrinter failed (Win32 Error: $err)"; exit 1
            [RawPrintV5]::ClosePrinter($h)
        }
    } else { 
        $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-Host "ERROR: OpenPrinter failed (Win32 Error: $err)"; exit 1 
    }
} else {
    # Direct Serial Printing
    try {
        # portName is pre-computed in JS to avoid PS backslash-escaping issues
        $portName = "${serialPortName}"
        $port = New-Object System.IO.Ports.SerialPort $portName, 9600, None, 8, one
        $port.WriteTimeout = 5000
        $port.DtrEnable = $true
        $port.RtsEnable = $true
        $port.Open()
        $wake = [byte[]]@(0x00, 0x1B, 0x40)
        $port.Write($wake, 0, $wake.Length)
        Start-Sleep -Milliseconds 500
        Start-Sleep -Seconds 1 # Wait for BT bridge to stabilize
        $b = [System.IO.File]::ReadAllBytes($f)
        $port.Write($b, 0, $b.Length)
        Start-Sleep -Milliseconds 500 # Ensure buffer is flushed
        $port.Close()
        Write-Host "SUCCESS: Sent $($b.Length) bytes to serial port '$portName'"
    } catch {
        Write-Host "ERROR: Serial port '$p' failed - $($_.Exception.Message)"
    }
}
`;
            fs.writeFileSync(scriptFile, psScript);
            const output = execSync(`powershell -ExecutionPolicy Bypass -File "${scriptFile}"`, { windowsHide: true });
            const result = output.toString().trim();
            if (result.includes('SUCCESS')) {
                return { success: true, message: result };
            } else {
                return { success: false, error: result || 'Unknown PowerShell error' };
            }
        } catch (e) {
            return { success: false, error: e.message };
        } finally {
            if (fs.existsSync(tempFile)) try { fs.unlinkSync(tempFile); } catch (e) { }
            if (fs.existsSync(scriptFile)) try { fs.unlinkSync(scriptFile); } catch (e) { }
        }
    } else {
        // TCP or Serial
        const printer = new ThermalPrinter({
            type: printerConfig.type === 'STAR' ? PrinterTypes.STAR : PrinterTypes.EPSON,
            interface: iface
        });
        try {
            printer.add(buffer);
            await printer.execute();
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
}

function getPrinterStatus() {
    const { getConfig } = require('./config');
    const config = getConfig();
    const iface = config.printer?.interface || 'auto';
    const model = config.printer?.model || 'generic';
    const type = config.printer?.type || 'EPSON';

    // Attempt a quick connection test
    // This is synchronous-ish but we'll return cached/last known if possible
    // For now, we'll just return the config and a 'ready' hint
    return {
        port: iface,
        model,
        interface: iface.startsWith('serial:') ? 'Serial/BT' : (iface.startsWith('printer:') ? 'Windows Spooler' : 'TCP'),
        type,
        ready: true // Default to true, we can refine this with a background check
    };
}

function setPrinterModel(model) {
    const { getConfig, saveConfig } = require('./config');
    const config = getConfig();
    config.printer = config.printer || {};
    config.printer.model = model;

    // Auto-set width and charset based on model
    if (model === 'pos58c') {
        config.printer.width = 58;
    } else if (model === 'tmv88') {
        config.printer.width = 80;
    }

    saveConfig(config);
    logger.info(`[Printer] Model updated to ${model} and saved to config.`);
}

async function printTestPage() {
    const testData = {
        username: 'TEST-1234',
        password: 'password',
        profile: 'Test Plan',
        loginUrl: 'http://192.168.88.1/login',
        duration: '1 Hour',
        price: 0.00,
        currency: '$'
    };
    const res = await printVoucher(testData);
    return res.success;
}

/**
 * printVoucher — Universal entry point.
 * Routes through PrintBroker (mobile BLE/USB → server) when the broker
 * has a connected Android/Cordova client; otherwise falls back directly
 * to the server-side hardware path (_printVoucherDirect).
 *
 * This is the function that ALL callers (REST API, Telegram, WhatsApp,
 * Discord, CLI, etc.) should use — no changes needed at call sites.
 */
async function printVoucher(voucherData, printerId = 'PRINTER_MAIN') {
    try {
        const { PrintBroker } = require('./print-broker');
        const broker = PrintBroker.getInstance();
        // Only route through broker if a mobile client is actually connected
        const mobileStatus = broker.getMobileClientStatus();
        if (mobileStatus.count > 0) {
            const result = await broker.print(voucherData, { preferMobile: true });
            return result;
        }
    } catch (_) {
        // PrintBroker not yet initialised or circular require — fall through
    }
    return _printVoucherDirect(voucherData, printerId);
}

module.exports = {
    printVoucher,
    _printVoucherDirect,          // used internally by PrintBroker as server fallback
    discoverBluetoothPrinterPort,
    discoverPrinterPort,
    testPrinterConnection,
    printRaw,
    getPrinterStatus,
    setPrinterModel,
    printTestPage,
    listAvailableInterfaces
};
