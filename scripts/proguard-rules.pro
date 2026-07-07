# Cordova/plugin ProGuard rules for release builds.
#
# Cordova instantiates plugin classes by fully-qualified name via reflection
# (looked up from config.xml/plugin.xml at runtime), and the JS<->native
# bridge invokes plugin methods (execute/onRequestPermissionResult/etc.) the
# same way. ProGuard's default release shrinking/obfuscation renames or
# strips exactly the classes/methods that reflection depends on unless they
# are explicitly kept -- when that happens, permission requests and other
# plugin calls silently fail at runtime (the plugin bridge can't find the
# class/method it's looking for), which looks like "permission strings are
# invalid" from the JS side even though the source code is correct.

# Cordova framework itself
-keep class org.apache.cordova.** { *; }
-keepclassmembers class org.apache.cordova.** { *; }

# Any class extending/implementing Cordova's plugin API (covers
# cordova-plugin-android-permissions, cordova-plugin-bluetooth-serial,
# cordova-plugin-camera, cordova-plugin-contacts, cordova-plugin-firebasex,
# cordova-plugin-local-notification, and every other installed plugin
# without needing to enumerate each plugin's package name individually).
-keep class * extends org.apache.cordova.CordovaPlugin { *; }
-keep class * implements org.apache.cordova.CordovaInterface { *; }
-keepclassmembers class * extends org.apache.cordova.CordovaPlugin {
    public <methods>;
    protected <methods>;
}

# Keep the actual android.permission.* constant names/strings intact -- some
# plugins resolve permission names via reflection on android.Manifest.permission
# rather than string literals.
-keepclassmembers class android.Manifest$permission { *; }

# WebView JS bridge interfaces (Android requires these to survive shrinking
# or the JS<->native bridge breaks entirely).
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Firebase / Google Play services (cordova-plugin-firebasex) -- standard
# recommended keep rules to avoid breaking Firestore/Auth model classes.
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# NOTE: obfuscation/shrinking themselves stay ENABLED (see build-extras.gradle)
# -- this file only carves out the reflection-dependent classes above so
# obfuscating the rest of the app doesn't break the plugin bridge.
