'use strict';

jest.mock('child_process');
jest.mock('fs');

const { execSync } = require('child_process');
const fs = require('fs');
const {
  listSerialPortsFromRegistry,
  comPortToInterface,
  listCUPSPrinters,
  listDevPrinters,
} = require('../../../src/drivers/printer/discovery');

describe('printer driver discovery', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listSerialPortsFromRegistry', () => {
    test('parses a bluetooth COM port from the registry output', () => {
      execSync.mockReturnValue(
        '    \\Device\\BthModem0    REG_SZ    COM7\n'
      );
      const result = listSerialPortsFromRegistry();
      expect(result).toEqual([
        { port: 'COM7', name: 'COM7 (Bluetooth RFCOMM)', type: 'bluetooth', bus: 'Bluetooth RFCOMM' },
      ]);
    });

    test('parses a USB serial port from the registry output', () => {
      execSync.mockReturnValue('    \\Device\\USBSER000    REG_SZ    COM3\n');
      const result = listSerialPortsFromRegistry();
      expect(result[0]).toMatchObject({ port: 'COM3', type: 'usb' });
    });

    test('parses multiple ports from multi-line output', () => {
      execSync.mockReturnValue(
        '\\Device\\BthModem0    REG_SZ    COM7\n\\Device\\Serial0    REG_SZ    COM1\n'
      );
      const result = listSerialPortsFromRegistry();
      expect(result).toHaveLength(2);
      expect(result.map(r => r.port)).toEqual(['COM7', 'COM1']);
    });

    test('returns an empty array (not throw) when the registry query fails', () => {
      execSync.mockImplementation(() => {
        throw new Error('command not found');
      });
      expect(listSerialPortsFromRegistry()).toEqual([]);
    });

    test('returns an empty array when there are no matching ports', () => {
      execSync.mockReturnValue('');
      expect(listSerialPortsFromRegistry()).toEqual([]);
    });
  });

  describe('comPortToInterface', () => {
    test('converts a bare COM port number to a node-thermal-printer interface string', () => {
      expect(comPortToInterface('COM7')).toBe('serial:\\\\.\\COM7');
    });

    test('is case-insensitive on the COM prefix', () => {
      expect(comPortToInterface('com3')).toBe('serial:\\\\.\\COM3');
    });
  });

  describe('listCUPSPrinters', () => {
    test('parses printer names accepting requests from lpstat output', () => {
      execSync.mockReturnValue('ZJ-58 accepting requests since Mon 01 Jan 2026\n');
      const result = listCUPSPrinters();
      expect(result).toEqual([{ id: 'cups:ZJ-58', name: 'ZJ-58', type: 'cups', bus: 'CUPS' }]);
    });

    test('parses multiple CUPS queues', () => {
      execSync.mockReturnValue(
        'ZJ-58 accepting requests since Mon\nTM-T88 accepting requests since Tue\n'
      );
      const result = listCUPSPrinters();
      expect(result.map(r => r.name)).toEqual(['ZJ-58', 'TM-T88']);
    });

    test('returns an empty array (not throw) when lpstat is unavailable', () => {
      execSync.mockImplementation(() => {
        throw new Error('lpstat: command not found');
      });
      expect(listCUPSPrinters()).toEqual([]);
    });
  });

  describe('listDevPrinters', () => {
    test('detects a writable /dev/usb/lp0 node', () => {
      fs.accessSync.mockImplementation(devPath => {
        if (devPath !== '/dev/usb/lp0') throw new Error('ENOENT');
      });
      fs.constants = { W_OK: 2 };

      const result = listDevPrinters();
      expect(result).toEqual([
        { id: 'dev:/dev/usb/lp0', name: '/dev/usb/lp0', type: 'dev', bus: 'USB Printer Class' },
      ]);
    });

    test('detects a writable /dev/ttyUSB node with the correct bus label', () => {
      fs.accessSync.mockImplementation(devPath => {
        if (devPath !== '/dev/ttyUSB0') throw new Error('ENOENT');
      });
      fs.constants = { W_OK: 2 };

      const result = listDevPrinters();
      expect(result[0]).toMatchObject({ id: 'dev:/dev/ttyUSB0', bus: 'USB Serial' });
    });

    test('returns an empty array when no device nodes are present', () => {
      fs.accessSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      fs.constants = { W_OK: 2 };
      expect(listDevPrinters()).toEqual([]);
    });
  });
});
