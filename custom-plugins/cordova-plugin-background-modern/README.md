# cordova-plugin-background-modern

A lifecycle-aware Cordova background runtime for Android.

## Why this exists

Older Cordova background plugins can call `startForeground()` as soon as their service is created. Modern Android versions restrict foreground-service startup and require a declared foreground-service type and matching permission. This plugin makes startup explicit and lifecycle-aware.

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
});
```

`start()` must be called from a user-visible Cordova activity. If the app is already backgrounded, the plugin returns `BACKGROUND_START_NOT_ALLOWED` instead of allowing an Android foreground-service exception to crash the process.

This plugin does not attempt to bypass Android background-start restrictions. Applications that need scheduled/background work should use the appropriate Android scheduling API for that workload.
