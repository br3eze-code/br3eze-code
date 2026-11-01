# Br3eze AgentOS — Expo compatibility shell

This is a separate Expo / React Native entry point. It does not replace the existing
Cordova application or alter the root Node.js AgentOS runtime.

## Requirements

- Node.js 22.13 or newer
- npm
- Expo Go compatible with SDK 58 for quick device previews, or a development build
  when native integrations are needed

## Run

From this directory:

```sh
npm install
cp .env.example .env
npx expo install --fix
npx expo start
```

Use the terminal QR code with Expo Go, or press `a` for an Android emulator.
If running on a physical device, both the device and development computer need
network connectivity to the Expo development server.

## Configure the web app URL

Set `EXPO_PUBLIC_APP_URL` in `.env` to the HTTPS deployment serving the AgentOS
web UI. The default is `https://br3eze.africa`; confirm that this is the intended
application endpoint before using it for production.

## Compatibility boundary

This first step embeds the existing web interface in a React Native WebView. It
does **not** port Cordova native plugins. Native Wi-Fi control, printing, camera,
Bluetooth, local SQLite, background execution, and other plugin-dependent features
must be replaced with Expo-compatible modules or custom native modules and tested
individually. Do not assume the Cordova JavaScript bridge is available inside Expo.

The existing Cordova build remains the production path until native feature parity,
authentication, payments, offline behavior, Android builds, and iOS builds have
been tested. Keep secrets out of `EXPO_PUBLIC_*` variables; these values are
embedded in the client bundle.
