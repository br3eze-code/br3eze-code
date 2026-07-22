# Cordova framework rules
-keep class org.apache.cordova.** { *; }
-keep public class * extends org.apache.cordova.CordovaPlugin

# Keep specific local plugins and classes to avoid reflection issues
-keep class com.powerconnect.www.** { *; }
-keep class com.wifibilling.agent.WiFiBillingAgentPlugin { *; }
-keep class cordova-plugin-bluetooth-serial.** { *; }
-keep class wifiwizard2.** { *; }

# Keep annotation names and generic signatures
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Keep Firebase, Google APIs, and related third-party libs
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }

# Suppress warnings for missing references/classes in dependencies
-dontwarn com.google.protobuf.java_com_google_android_gmscore_sdk_target_granule__proguard_group_gtm_N1281923064GeneratedExtensionRegistryLite$Loader
-dontwarn org.webrtc.Environment$Builder
-dontwarn org.webrtc.Environment
