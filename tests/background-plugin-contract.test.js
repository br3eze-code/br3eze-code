import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('cordova-plugin-background-modern contract', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pluginRoot = path.join(root, 'custom-plugins', 'cordova-plugin-background-modern');
  const pluginXml = fs.readFileSync(path.join(pluginRoot, 'plugin.xml'), 'utf8');
  const androidService = fs.readFileSync(path.join(pluginRoot, 'src', 'android', 'BackgroundService.java'), 'utf8');
  const androidBridge = fs.readFileSync(path.join(pluginRoot, 'src', 'android', 'BackgroundPlugin.java'), 'utf8');
  const iosBridge = fs.readFileSync(path.join(pluginRoot, 'src', 'ios', 'BackgroundPlugin.m'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'config.xml'), 'utf8');

  test('is registered as the application background plugin', () => {
    expect(config).toContain('cordova-plugin-background-modern');
    expect(pluginXml).toContain('cordova-plugin-background-modern');
  });

  test('uses modern Android foreground-service permissions and type', () => {
    expect(pluginXml).toContain('android.permission.FOREGROUND_SERVICE');
    expect(pluginXml).toContain('android.permission.FOREGROUND_SERVICE_SPECIAL_USE');
    expect(pluginXml).toContain('android:foregroundServiceType="specialUse"');
    expect(pluginXml).toContain('PROPERTY_SPECIAL_USE_FGS_SUBTYPE');
  });

  test('does not use the crashed legacy de.appplant service', () => {
    expect(config).not.toContain('de.appplant.cordova.plugin.background');
    expect(pluginXml).not.toContain('de.appplant.cordova.plugin.background');
    expect(androidService).not.toContain('de.appplant.cordova.plugin.background');
    expect(androidBridge).not.toContain('de.appplant.cordova.plugin.background');
  });

  test('only uses the three-argument startForeground API on Android 14+', () => {
    expect(androidService).toContain('Build.VERSION.SDK_INT >= 34');
    expect(androidService).toContain('ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE');
  });

  test('guards foreground-service failures instead of letting them escape from onCreate', () => {
    expect(androidService).toContain('catch (RuntimeException error)');
    expect(androidService).toContain('stopSelf();');
    expect(androidBridge).toContain('FOREGROUND_SERVICE_START_FAILED');
  });

  test('contains an iOS implementation with the same lifecycle API', () => {
    expect(pluginXml).toContain('ios-package');
    expect(iosBridge).toContain('- (void)start:');
    expect(iosBridge).toContain('- (void)stop:');
    expect(iosBridge).toContain('- (void)status:');
  });
});
