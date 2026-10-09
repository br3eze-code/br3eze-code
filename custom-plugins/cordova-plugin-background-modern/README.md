# cordova-plugin-background-modern v2

A lifecycle-aware Cordova background runtime.

## Android

- Android 8+ (`minSdk 26`).
- Uses `startForegroundService()` on Android 8+.
- Uses the three-argument `startForeground()` only on Android 14+ where the service type is required.
- Declares `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_SPECIAL_USE` correctly.
- Does not start a foreground service automatically during app startup.
- Refuses `start()` while the Cordova activity is not visible.
- Catches service-start failures and reports them to JavaScript rather than crashing the host process.
- The service also catches foreground-promotion failures so a policy/permission failure cannot escape as a fatal service exception.
- `status()` reports the actual in-process service state.

## iOS

iOS does not provide an Android-style persistent foreground service. The iOS implementation therefore uses Apple's finite background-task mechanism and reports its limited lifetime through the same API. It does not pretend that arbitrary JavaScript can run indefinitely in the background.

## API

```js
cordova.plugins.backgroundModern.start(
  function (result) { console.log('started', result); },
  function (error) { console.error(error); }
);

cordova.plugins.backgroundModern.status(function (result) {
  console.log(result);
});

cordova.plugins.backgroundModern.stop(function (result) {
  console.log('stopped', result); 
}, function (error) {
  console.error(error);
});
```

`start()` is explicit. The plugin never attempts to bypass Android's background-start restrictions.

## Migration from the old plugin

Remove the old `de.appplant.cordova.plugin.background` plugin from the generated Cordova project before rebuilding. Do not keep both background services installed.

After changing the plugin set, perform a clean Cordova platform rebuild so stale generated plugin sources cannot remain in `platforms/android`.
