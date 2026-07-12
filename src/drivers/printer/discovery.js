/**
 * src/drivers/printer/discovery.js
 * ─────────────────────────────────────────────────────────────────
 * Printer Driver: OS-specific hardware discovery.
 *
 * This is the concrete, platform-specific half of printer support —
 * previously mixed directly into src/core/printer.js alongside
 * voucher-formatting business logic, violating the Kernel/Driver
 * boundary (Kernel should stay domain-agnostic; anything that shells
 * out to `reg query`, `lpstat`, or reads /dev nodes is Driver-layer
 * by definition). Extracted verbatim — no logic changes — so
 * src/core/printer.js can depend on this instead of doing OS
 * detection itself.
 * ─────────────────────────────────────────────────────────────────
 */

import { execSync } from 'child_process';
import fs from 'fs';
import { logger } from '../../core/logger.js';

/**
 * List active COM ports from the Windows registry (SERIALCOMM key).
 * Returns [{ port: 'COM7', name: ..., type: 'bluetooth'|'usb'|'serial', bus }]
 */
function listSerialPortsFromRegistry() {
  const results = [];
  try {
    const raw = execSync('reg query "HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM" 2>nul', {
      timeout: 2000,
      encoding: 'utf8',
      windowsHide: true,
    });
    const regex = /([^\s]+)\s+REG_SZ\s+(COM\d+)/gi;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      const devPath = match[1].toLowerCase();
      const comId = match[2].toUpperCase();
      let type = 'serial',
        bus = 'Serial Port';
      if (devPath.includes('bth') || devPath.includes('bluetooth')) {
        type = 'bluetooth';
        bus = 'Bluetooth RFCOMM';
      } else if (devPath.includes('usb') || devPath.includes('usbser')) {
        type = 'usb';
        bus = 'USB Serial';
      } else if (devPath.includes('vcp')) {
        type = 'usb';
        bus = 'Virtual COM Port';
      }
      results.push({ port: comId, name: `${comId} (${bus})`, type, bus });
    }
  } catch (e) {
    logger.debug(`[PrinterDriver] SERIALCOMM registry query failed: ${e.message}`);
  }
  return results;
}

/** Convert bare COMx or serial:COMx to node-thermal-printer interface string */
function comPortToInterface(deviceID) {
  const portNum = parseInt(String(deviceID).replace(/^COM/i, ''), 10);
  return `serial:\\\\.\\COM${portNum}`;
}

/**
 * Discover CUPS queues on Linux via `lpstat -a`.
 * Returns [{ id: 'cups:PRINTER_NAME', name, type: 'cups', bus: 'CUPS' }]
 */
function listCUPSPrinters() {
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
    logger.debug(`[PrinterDriver] lpstat discovery failed: ${e.message}`);
  }
  return results;
}

/**
 * Discover thermal printers attached as /dev/usb/lp* or /dev/ttyUSB* nodes.
 * Returns [{ id: 'dev:/dev/usb/lp0', name, type: 'dev', bus }]
 */
function listDevPrinters() {
  const results = [];
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
          bus: prefix.includes('usb/lp') ? 'USB Printer Class' : 'USB Serial',
        });
      } catch (_) {
        /* not present */
      }
    }
  }
  return results;
}

module.exports = {
  listSerialPortsFromRegistry,
  comPortToInterface,
  listCUPSPrinters,
  listDevPrinters,
};
