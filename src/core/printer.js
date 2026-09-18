/**
 * Domain-neutral print capability boundary. Hardware/formatting providers are injected.
 */
let provider = null;
export function registerPrinterProvider(next) { if (!next) throw new TypeError('Printer provider required'); provider = next; return provider; }
export function getPrinterProvider() { return provider; }
export async function printVoucher(...args) { if (!provider?.printVoucher) throw new Error('No printer provider registered'); return provider.printVoucher(...args); }
export async function testPrinterConnection(...args) { if (!provider?.testPrinterConnection) return { success: false, message: 'No printer provider registered' }; return provider.testPrinterConnection(...args); }
export async function discoverBluetoothPrinterPort(...args) { if (!provider?.discoverBluetoothPrinterPort) return null; return provider.discoverBluetoothPrinterPort(...args); }
export async function listAvailableInterfaces(...args) { if (!provider?.listAvailableInterfaces) return []; return provider.listAvailableInterfaces(...args); }
export async function getPrinterStatus(...args) { if (!provider?.getPrinterStatus) return { connected: false, message: 'No printer provider registered' }; return provider.getPrinterStatus(...args); }
export async function printRaw(...args) { if (!provider?.printRaw) throw new Error('No printer provider registered'); return provider.printRaw(...args); }
export async function print(...args) { if (!provider?.print) throw new Error('No printer provider registered'); return provider.print(...args); }
export default { registerPrinterProvider, getPrinterProvider, printVoucher, testPrinterConnection, discoverBluetoothPrinterPort, listAvailableInterfaces, getPrinterStatus, printRaw, print };
