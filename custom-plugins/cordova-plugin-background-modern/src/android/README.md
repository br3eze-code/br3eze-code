# Android implementation

The implementation deliberately starts the foreground service only while the Cordova activity is visible and converts Android startup failures into plugin errors instead of allowing an uncaught exception to terminate the app.
