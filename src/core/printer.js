import { printer as ThermalPrinter, types as PrinterTypes } from 'node-thermal-printer';
import QRCode from 'qrcode';
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { STATE_PATH, getConfig, BRAND, saveConfig } from './config.js';
import { PrintBroker } from './print-broker.js';

// ─────────────────────────────────────────────────────────────────────────────
// Port discovery cache
// ─────────────────────────────────────────────────────────────────────────────
let cachedBtPort = null;
let lastDiscoveryTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─────────────────────────────────────────────────────────────────────────────
// Windows helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List active COM ports from the Windows registry (SERIALCOMM key).
 * Returns [{ port: 'COM7', name: ..., type: 'bluetooth'|'usb'|'serial', bus }]
 */
function _listSerialPortsFromRegistry() {
    const results = [];
    try {
        const raw = execSync(
            'reg query "HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM" 2>nul',
            { timeout: 2000, encoding: 'utf8', windowsHide: true }
        );
        const regex = /([^\s]+)\s+REG_SZ\s+(COM\d+)/gi;
        let match;
        while ((match = regex.exec(raw)) !== null) {
            const devPath = match[1].toLowerCase();
            const comId = match[2].toUpperCase();
            let type = 'serial', bus = 'Serial Port';
            if (devPath.includes('bth') || devPath.includes('bluetooth')) { type = 'bluetooth'; bus = 'Bluetooth RFCOMM'; }
            else if (devPath.includes('usb') || devPath.includes('usbser')) { type = 'usb'; bus = 'USB Serial'; }
            else if (devPath.includes('vcp')) { type = 'usb'; bus = 'Virtual COM Port'; }
            results.push({ port: comId, name: `${comId} (${bus})`, type, bus });
        }
    } catch (e) {
        logger.debug(`[Printer] SERIALCOMM registry query failed: ${e.message}`);
    }
    return results;
}

/** Convert bare COMx or serial:COMx to node-thermal-printer interface string */
function _comPortToInterface(deviceID) {
    const portNum = parseInt(String(deviceID).replace(/^COM/i, ''), 10);
    return `serial:\\\\.\\COM${portNum}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Linux helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discover CUPS queues on Linux via `lpstat -a`.
 * Returns [{ id: 'cups:PRINTER_NAME', name, type: 'cups', bus: 'CUPS' }]
 */
function _listCUPSPrinters() {
    const results = [];
    try {
        const raw = execSync('lpstat -a 2>/dev/null', { timeout: 3000, encoding: 'utf8' });
        // e.g. "ZJ-58 accepting requests since ..."
        raw.split('\n').forEach(line => {
            const m = line.match(/^(\S+)\s+accepting/i);
            if (m) {
                results.push({ id: `cups:${m[1]}`, name: m[1], type: 'cups', bus: 'CUPS' });
            }
        });
    } catch (e) {
        logger.debug(`[Printer] lpstat discovery failed: ${e.message}`);
    }
    return results;
}

/**
 * Discover thermal printers attached as /dev/usb/lp* or /dev/ttyUSB* nodes.
 * Returns [{ id: 'dev:/dev/usb/lp0', name, type: 'dev', bus }]
 */
function _listDevPrinters() {
    const results = [];
    // macOS names serial devices /dev/cu.usbserial-XXXX / /dev/tty.usbmodemXXXX
    // (non-numbered), so enumerate /dev and match by prefix.
    if (process.platform === 'darwin') {
        try {
            for (const name of fs.readdirSync('/dev')) {
                if (/^(cu|tty)\.(usb|serial)/i.test(name)) {
                    const devPath = `/dev/${name}`;
                    try { fs.accessSync(devPath, fs.constants.W_OK); results.push({ id: `dev:${devPath}`, name: devPath, type: 'dev', bus: 'macOS serial' }); } catch (_) {}
                }
            }
        } catch (_) {}
    }
    const patterns = ['/dev/usb/lp', '/dev/ttyUSB', '/dev/ttyACM'];
    for (const prefix of patterns) {
        for (let i = 0; i < 8; i++) {
            const devPath = `${prefix}${i}`;
            try {
                fs.accessSync(devPath, fs.constants.W_OK);
                results.push({
                    id: `dev:${devPath}`,
                    name: devPath,
                    type: 'dev',
                    bus: prefix.includes('usb/lp') ? 'USB Printer Class' : 'USB Serial'
                });
            } catch (_) { /* not present */ }
        }
    }
    return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-platform port/queue discovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all available printer interfaces on the current platform.
 * @returns {Promise<Array>}
 */
async function listAvailableInterfaces() {
    const interfaces = [];
    const isWin = process.platform === 'win32';
    const isLinux = process.platform === 'linux';
    const isMac = process.platform === 'darwin';

    if (isWin) {
        // Windows Spooler printers
        try {
            const raw = execSync(
                'powershell -Command "Get-Printer | Select-Object Name, PrinterStatus, JobCount | ConvertTo-Json"',
                { timeout: 5000, encoding: 'utf8', windowsHide: true }
            );
            if (raw.trim()) {
                let printers = JSON.parse(raw);
                if (!Array.isArray(printers)) printers = [printers];
                printers.forEach(p => {
                    if (p && p.Name) {
                        const s = p.PrinterStatus;
                        let statusText = s === 1 || s === 3 ? 'online' : s === 2 || s === 7 || s === 128 ? 'offline' : 'unknown';
                        interfaces.push({ id: `printer:${p.Name}`, name: p.Name, type: 'printer', bus: 'Windows Spooler', status: statusText, jobs: p.JobCount || 0 });
                    }
                });
            }
        } catch (e) {
            logger.debug(`[Printer] Failed to list Windows printers: ${e.message}`);
        }

        // Windows COM ports
        _listSerialPortsFromRegistry().forEach(p => {
            interfaces.push({ id: `serial:${p.port}`, name: p.name, type: 'serial', bus: p.bus });
        });
    }

    // macOS shares the CUPS + /dev POSIX printer stack with Linux (lpstat/lpr,
    // /dev/tty.usbserial*), so run the same discovery there.
    if (isLinux || isMac) {
        _listCUPSPrinters().forEach(p => interfaces.push(p));
        _listDevPrinters().forEach(p => interfaces.push(p));
    }

    if (interfaces.length === 0) {
        interfaces.push({ id: 'auto', name: 'Auto Discover', type: 'auto' });
    }
    return interfaces;
}

/**
 * Discover a printer port automatically.
 * Windows: probes registry COM ports (BT first, then USB).
 * Linux: returns first CUPS queue, then first /dev node.
 * @returns {string|null}
 */
function discoverPrinterPort(preferredType = 'any', retries = 1) {
    const now = Date.now();
    if (cachedBtPort && (now - lastDiscoveryTime < CACHE_TTL) && preferredType === 'any') {
        logger.debug(`[Printer] Using cached printer port: ${cachedBtPort}`);
        return cachedBtPort;
    }

    const isWin = process.platform === 'win32';
    const isLinux = process.platform === 'linux';
    const isMac = process.platform === 'darwin';
    let attempts = 0;

    while (attempts <= retries) {
        if (isWin) {
            const ports = _listSerialPortsFromRegistry();
            const blacklist = ['COM1', 'COM11', 'LPT1'];
            const filtered = ports.filter(p => !blacklist.includes(p.port.toUpperCase()));

            for (const typeFilter of ['bluetooth', 'usb', 'serial']) {
                if (preferredType !== 'any' && preferredType !== typeFilter) continue;
                for (const p of filtered.filter(x => x.type === typeFilter)) {
                    try {
                        execSync(
                            `powershell -Command "try { $p = New-Object System.IO.Ports.SerialPort '${p.port}', 9600; $p.Open(); $p.Close(); exit 0 } catch { exit 1 }"`,
                            { timeout: 2000, windowsHide: true }
                        );
                        const iface = _comPortToInterface(p.port);
                        cachedBtPort = iface;
                        lastDiscoveryTime = now;
                        logger.info(`[Printer] Auto-discovered ${typeFilter} printer on ${iface} (${p.name})`);
                        return iface;
                    } catch (_) {}
                }
            }
        }

        if (isLinux || isMac) {
            // 1. Try CUPS first (available on both Linux and macOS)
            const cups = _listCUPSPrinters();
            if (cups.length > 0) {
                const iface = cups[0].id;
                cachedBtPort = iface;
                lastDiscoveryTime = now;
                logger.info(`[Printer] Auto-discovered CUPS printer: ${iface}`);
                return iface;
            }
            // 2. Try /dev nodes
            const devs = _listDevPrinters();
            if (devs.length > 0) {
                const iface = devs[0].id;
                cachedBtPort = iface;
                lastDiscoveryTime = now;
                logger.info(`[Printer] Auto-discovered device printer: ${iface}`);
                return iface;
            }
        }

        attempts++;
        if (attempts <= retries) {
            const start = Date.now();
            while (Date.now() - start < 1000) { /* sync wait */ }
        }
    }

    logger.debug(`[Printer] No printer port auto-discovered after ${retries + 1} attempt(s).`);
    return null;
}

// Backward compat alias
const discoverBluetoothPrinterPort = discoverPrinterPort;

// ─────────────────────────────────────────────────────────────────────────────
// Linux delivery helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send raw ESC/POS buffer to a Linux CUPS queue via `lp`.
 */
function _spoolToCUPS(buffer, queueName, tempDir) {
    const tmpFile = path.join(tempDir || STATE_PATH, `print_${Date.now()}.bin`);
    try {
        fs.writeFileSync(tmpFile, buffer);
        const result = spawnSync('lp', ['-d', queueName, '-o', 'raw', tmpFile], { timeout: 10000 });
        if (result.status !== 0) {
            const stderr = result.stderr ? result.stderr.toString().trim() : '';
            throw new Error(`lp exited ${result.status}: ${stderr}`);
        }
        logger.info(`[Printer] Spooled to CUPS queue '${queueName}'`);
        return true;
    } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
}

/**
 * Send raw ESC/POS buffer directly to a /dev node.
 */
function _writeToDevNode(buffer, devPath) {
    const fd = fs.openSync(devPath, 'w');
    try {
        fs.writeSync(fd, buffer, 0, buffer.length);
        logger.info(`[Printer] Wrote ${buffer.length} bytes to ${devPath}`);
    } finally {
        fs.closeSync(fd);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core voucher print routine
// ─────────────────────────────────────────────────────────────────────────────

async function _printVoucherDirect(voucherData, printerId = 'PRINTER_MAIN', _triedInterfaces = []) {
    const config = getConfig();

    if (!voucherData?.username) {
        const msg = `printVoucher called with missing 'username'. Pass { username, password, profile, loginUrl }.`;
        logger.error(`[Printer] ❌ ${msg}`);
        return { success: false, error: msg };
    }

    const { username, password, profile } = voucherData;
    const loginUrl = voucherData.loginUrl ||
        `http://${config.mikrotik?.ip || config.adapters?.mikrotik?.host || '192.168.88.1'}/login.html?code=${username}`;

    const printerEnabledStr = process.env[`${printerId}_ENABLED`];
    const isPrinterEnabled = printerEnabledStr ? printerEnabledStr !== 'false' : config.printer?.enabled !== false;
    if (!isPrinterEnabled) {
        logger.info(`[Printer] Printing disabled for ${printerId} — skipping.`);
        return { success: false, error: 'Printer disabled in configuration.' };
    }

    let iface = process.env[`${printerId}_INTERFACE`] || config.printer?.interface || 'auto';
    const printerTypeStr = process.env[`${printerId}_TYPE`] || config.printer?.type || 'EPSON';
    const printerModel = process.env[`${printerId}_MODEL`] || config.printer?.model || 'generic';

    // Auto-discover if needed
    if (['auto', 'ble', 'usb', 'tcp://192.168.88.254'].includes(iface)) {
        const discovered = discoverPrinterPort('any');
        iface = discovered || 'tcp://192.168.88.254';
    } else {
        // Normalise bare COMx on Windows
        if (/^COM\d+$/i.test(iface)) iface = _comPortToInterface(iface);
        else if (/^serial:COM\d+$/i.test(iface)) iface = _comPortToInterface(iface.replace('serial:', ''));
        // Strip ble:// or usb:// pseudo-protocols
        iface = iface.replace(/^(ble|usb):\/\//i, '');
    }

    let printerWidth = config.printer?.width || 80;
    let charSet = 'PC858_EURO';
    if (printerModel.toLowerCase().includes('58') || printerModel.toLowerCase() === 'pos-58c') {
        printerWidth = 58;
        charSet = 'PC437_USA';
    }

    const printerType = printerTypeStr === 'STAR' ? PrinterTypes.STAR : PrinterTypes.EPSON;
    const isWindowsRaw = process.platform === 'win32' && (iface.startsWith('printer:') || iface.startsWith('serial:'));
    const isCUPS = iface.startsWith('cups:');
    const isDev = iface.startsWith('dev:');

    // When targeting Windows spooler/serial we generate the buffer via a dummy
    // node-thermal-printer interface and send it ourselves via PowerShell.
    const printerConfig = {
        type: printerType,
        interface: (isWindowsRaw || isCUPS || isDev) ? 'tcp://127.0.0.1' : iface,
        characterSet: charSet,
        width: printerWidth,
        options: { timeout: config.printer?.timeout || 5000 }
    };

    logger.info(`[Printer] Initializing ${printerModel} (${printerWidth}mm). Interface: ${iface}, Type: ${printerTypeStr}`);

    try {
        const printer = new ThermalPrinter(printerConfig);

        // ── Build receipt ────────────────────────────────────────────────────
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

        if (printerWidth === 58) printer.setTextSize(0, 0);
        else printer.setTextSize(1, 1);

        printer.invert(true);
        printer.println(`  CODE: ${username}  `);
        printer.invert(false);
        printer.setTextNormal();
        printer.newLine();

        printer.leftRight('Plan:', profile);
        if (voucherData.duration) printer.leftRight('Duration:', voucherData.duration);
        if (voucherData.expires) printer.leftRight('Expires:', new Date(voucherData.expires).toLocaleDateString());
        if (voucherData.price) printer.leftRight('Price:', `${voucherData.currency || '$'}${Number(voucherData.price).toFixed(2)}`);
        printer.drawLine();

        printer.alignCenter();
        printer.println('SCAN TO CONNECT');
        try {
            const qrWidth = printerWidth === 58 ? 200 : 250;
            const qrBuffer = await QRCode.toBuffer(loginUrl, { type: 'png', width: qrWidth, margin: 2, errorCorrectionLevel: 'M' });
            await printer.printImageBuffer(qrBuffer);
        } catch (qrErr) {
            logger.error(`[Printer] QR image fallback: ${qrErr.message}`);
            printer.printQR(loginUrl, { cellSize: printerWidth === 58 ? 4 : 6, correction: 'M', model: 2 });
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

        // ── Platform-specific delivery ───────────────────────────────────────
        if (isWindowsRaw) {
            await _deliverWindowsRaw(printer, iface);
        } else if (isCUPS) {
            const queueName = iface.replace('cups:', '');
            const buf = printer.getBuffer();
            _spoolToCUPS(buf, queueName);
        } else if (isDev) {
            const devPath = iface.replace('dev:', '');
            const buf = printer.getBuffer();
            _writeToDevNode(buf, devPath);
        } else {
            // TCP or standard node-thermal-printer path
            await printer.execute();
        }

        logger.info(`[Printer] ✅ Voucher printed successfully for ${username} via ${iface}`);
        const qrDataURI = await QRCode.toDataURL(loginUrl);
        return { success: true, qrDataURI, interface: iface };

    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[Printer] ❌ Error printing for ${voucherData?.username} via ${iface}: ${errorMsg}`);

        // Auto-fallback: try next available interface (max 3 attempts)
        _triedInterfaces.push(iface);
        if (_triedInterfaces.length < 3) {
            try {
                const available = await listAvailableInterfaces();
                const candidates = available.filter(p => !_triedInterfaces.includes(p.id));
                if (candidates.length > 0) {
                    const next = candidates[0].id;
                    logger.info(`[Printer] Trying fallback: ${next}`);
                    return await _printVoucherDirect(voucherData, next, _triedInterfaces);
                }
            } catch (fallbackErr) {
                logger.error(`[Printer] Fallback failed: ${fallbackErr.message}`);
            }
        }

        return { success: false, error: errorMsg, code: e?.code };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows raw delivery via PowerShell (spooler Win32 API or serial port)
// ─────────────────────────────────────────────────────────────────────────────

async function _deliverWindowsRaw(printer, iface) {
    const isSpooler = iface.startsWith('printer:');
    const rawTarget = isSpooler ? iface.replace('printer:', '') : iface.replace('serial:', '');
    const comMatch = rawTarget.match(/COM(\d+)/i);
    const serialPortName = comMatch ? `COM${comMatch[1]}` : rawTarget.replace(/[^a-zA-Z0-9]/g, '');
    const buffer = printer.getBuffer();
    const tempFile = path.join(STATE_PATH, `print_${Date.now()}.bin`);
    const scriptFile = path.join(STATE_PATH, `print_${Date.now()}.ps1`);

    fs.writeFileSync(tempFile, buffer);
    const psScript = `
$ErrorActionPreference = "Stop"
$p = "${rawTarget}"
$f = "${tempFile.replace(/\\/g, '\\\\')}"
$isSpooler = ${isSpooler ? '$true' : '$false'}

if ($isSpooler) {
    $code = @"
    using System; using System.Runtime.InteropServices;
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
    $di.pDocName = "AgentOS Voucher"; $di.pDatatype = "RAW"
    if ([RawPrintV5]::OpenPrinter($p.Trim(), [ref]$h, [IntPtr]::Zero)) {
        $docId = [RawPrintV5]::StartDocPrinter($h, 1, [ref]$di)
        if ($docId -eq 0) { $di.pDatatype = $null; $docId = [RawPrintV5]::StartDocPrinter($h, 1, [ref]$di) }
        if ($docId -ne 0) {
            if ([RawPrintV5]::StartPagePrinter($h)) {
                $b = [System.IO.File]::ReadAllBytes($f)
                $ptr = [System.Runtime.InteropServices.Marshal]::AllocCoTaskMem($b.Length)
                [System.Runtime.InteropServices.Marshal]::Copy($b, 0, $ptr, $b.Length)
                $written = 0
                if ([RawPrintV5]::WritePrinter($h, $ptr, $b.Length, [ref]$written)) {
                    [RawPrintV5]::EndPagePrinter($h); [RawPrintV5]::EndDocPrinter($h)
                    Write-Host "SUCCESS: Sent $written bytes to spooler '$p'"
                } else { throw "WritePrinter failed" }
                [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($ptr)
            } else { throw "StartPagePrinter failed" }
        } else { $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error(); throw "StartDocPrinter failed (Win32 Error: $err)" }
        [RawPrintV5]::ClosePrinter($h)
    } else { $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error(); throw "OpenPrinter failed (Win32 Error: $err)" }
} else {
    $portName = "${serialPortName}"
    $port = New-Object System.IO.Ports.SerialPort $portName, 9600, None, 8, one
    $port.WriteTimeout = 5000; $port.DtrEnable = $true; $port.RtsEnable = $true
    try { $port.Open() } catch { Write-Host "ERROR: Failed to open $portName. ($($_.Exception.Message))"; exit 1 }
    $wake = [byte[]]@(0x00, 0x1B, 0x40); $port.Write($wake, 0, $wake.Length)
    Start-Sleep -Milliseconds 500
    $b = [System.IO.File]::ReadAllBytes($f); $port.Write($b, 0, $b.Length)
    Start-Sleep -Milliseconds 500; $port.Close()
    Write-Host "SUCCESS: Sent $($b.Length) bytes to serial port '$portName'"
}
`;
    try {
        fs.writeFileSync(scriptFile, psScript);
        let output;
        try {
            output = execSync(`powershell -ExecutionPolicy Bypass -File "${scriptFile}"`, { windowsHide: true, stdio: 'pipe' });
        } catch (execError) {
            const stdout = execError.stdout ? execError.stdout.toString().trim() : '';
            const stderr = execError.stderr ? execError.stderr.toString().trim() : '';
            throw new Error(stdout || stderr || execError.message);
        }
        const result = output.toString().trim();
        if (!result.includes('SUCCESS')) throw new Error(result || 'Unknown PowerShell error');
        logger.info(`[Printer] ${result}`);
    } finally {
        try { fs.unlinkSync(tempFile); } catch (_) {}
        try { fs.unlinkSync(scriptFile); } catch (_) {}
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection test
// ─────────────────────────────────────────────────────────────────────────────

async function testPrinterConnection(printerConfig = {}) {
    let iface = printerConfig.interface || 'auto';
    const isAutoAny = ['auto', 'tcp://192.168.88.254'].includes(iface);
    let portSource = 'configured', portDiscovered = false;

    if (isAutoAny) {
        const discovered = discoverPrinterPort('any');
        if (discovered) { iface = discovered; portSource = 'discovered'; portDiscovered = true; }
        else { iface = 'tcp://192.168.88.254'; portSource = 'fallback'; }
    }

    // On Linux test CUPS / dev nodes directly
    if (iface.startsWith('cups:')) {
        const queueName = iface.replace('cups:', '');
        try {
            execSync(`lpstat -p ${queueName} 2>/dev/null`, { timeout: 3000 });
            return { success: true, port: iface, portSource, portDiscovered, message: 'CUPS queue online' };
        } catch (_) {
            return { success: false, port: iface, portSource, portDiscovered, message: 'CUPS queue unavailable' };
        }
    }

    if (iface.startsWith('dev:')) {
        const devPath = iface.replace('dev:', '');
        try {
            fs.accessSync(devPath, fs.constants.W_OK);
            return { success: true, port: iface, portSource, portDiscovered, message: `${devPath} writable` };
        } catch (_) {
            return { success: false, port: iface, portSource, portDiscovered, message: `${devPath} not accessible` };
        }
    }

    const printerType = printerConfig.type === 'STAR' ? PrinterTypes.STAR : PrinterTypes.EPSON;
    const config = { type: printerType, interface: iface, characterSet: printerConfig.characterSet || 'PC437_USA', options: { timeout: printerConfig.timeout || 5000 } };

    try {
        const printer = new ThermalPrinter(config);
        const isConnected = await printer.isPrinterConnected();
        if (isConnected) return { success: true, port: iface, portSource, portDiscovered, message: 'Connected' };
        return { success: false, port: iface, portSource, portDiscovered, message: portDiscovered ? `Port found but printer not responding` : 'Disconnected' };
    } catch (e) {
        const msg = e.message || String(e);
        if (msg.includes('Access denied') || msg.includes('EBUSY')) {
            return { success: true, port: iface, portSource, portDiscovered, message: 'Active (Port Busy / Access Denied)' };
        }
        return { success: false, port: iface, portSource, portDiscovered, message: msg };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * printVoucher — Universal entry point.
 * Routes through PrintBroker (mobile BLE/USB) when available, otherwise direct.
 */
async function printVoucher(voucherData, printerId = 'PRINTER_MAIN') {
    try {
        const broker = PrintBroker.getInstance();
        if (broker.getMobileClientStatus().count > 0) {
            return await broker.print(voucherData, { preferMobile: true });
        }
    } catch (_) { /* PrintBroker not available */ }
    return _printVoucherDirect(voucherData, printerId);
}

function getPrinterStatus() {
    const config = getConfig();
    const iface = config.printer?.interface || 'auto';
    const isLinux = process.platform === 'linux';
    let ifaceType = 'TCP';
    if (iface.startsWith('serial:') || iface.startsWith('COM')) ifaceType = 'Serial/BT';
    else if (iface.startsWith('printer:')) ifaceType = 'Windows Spooler';
    else if (iface.startsWith('cups:')) ifaceType = 'CUPS';
    else if (iface.startsWith('dev:')) ifaceType = 'Linux Device';
    return {
        platform: process.platform,
        port: iface,
        model: config.printer?.model || 'generic',
        interface: ifaceType,
        type: config.printer?.type || 'EPSON',
        ready: true
    };
}

function setPrinterModel(model) {
    const config = getConfig();
    config.printer = config.printer || {};
    config.printer.model = model;
    if (model === 'pos58c') config.printer.width = 58;
    else if (model === 'tmv88') config.printer.width = 80;
    saveConfig(config);
    logger.info(`[Printer] Model updated to ${model}`);
}

async function printTestPage() {
    return printVoucher({
        username: 'TEST-1234',
        password: 'password',
        profile: 'Test Plan',
        loginUrl: 'http://192.168.88.1/login',
        duration: '1 Hour',
        price: 0.00,
        currency: '$'
    });
}

async function printRaw(buffer, printerConfig = {}) {
    let iface = printerConfig.interface || 'auto';
    if (iface === 'auto') iface = discoverPrinterPort('any') || 'tcp://192.168.88.254';

    if (iface.startsWith('cups:')) { _spoolToCUPS(buffer, iface.replace('cups:', '')); return { success: true }; }
    if (iface.startsWith('dev:')) { _writeToDevNode(buffer, iface.replace('dev:', '')); return { success: true }; }

    const isWindowsRaw = process.platform === 'win32' && (iface.startsWith('printer:') || iface.startsWith('serial:'));
    if (isWindowsRaw) {
        // Build minimal printer to get buffer, then PowerShell-deliver
        const p = new ThermalPrinter({ type: PrinterTypes.EPSON, interface: 'tcp://127.0.0.1' });
        p.add(buffer);
        await _deliverWindowsRaw(p, iface);
        return { success: true };
    }

    const printer = new ThermalPrinter({ type: printerConfig.type === 'STAR' ? PrinterTypes.STAR : PrinterTypes.EPSON, interface: iface });
    printer.add(buffer);
    await printer.execute();
    return { success: true };
}

module.exports = {
    printVoucher,
    _printVoucherDirect,
    discoverBluetoothPrinterPort,
    discoverPrinterPort,
    testPrinterConnection,
    printRaw,
    getPrinterStatus,
    setPrinterModel,
    printTestPage,
    listAvailableInterfaces,
    _listCUPSPrinters,
    _listDevPrinters
};
