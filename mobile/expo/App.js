import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

const APP_URL =
  process.env.EXPO_PUBLIC_APP_URL || 'https://br3eze.africa';

export default function App() {
  const webView = useRef(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const goBack = useCallback(() => {
    if (canGoBack && webView.current) {
      webView.current.goBack();
      return true;
    }
    return false;
  }, [canGoBack]);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      goBack,
    );
    return () => subscription.remove();
  }, [goBack]);

  const retry = useCallback(() => {
    setError('');
    setLoading(true);
    webView.current?.reload();
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      <WebView
        ref={webView}
        source={{ uri: APP_URL }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsBackForwardNavigationGestures
        setSupportMultipleWindows={false}
        startInLoadingState
        onNavigationStateChange={(state) => setCanGoBack(state.canGoBack)}
        onLoadStart={() => {
          setLoading(true);
          setError('');
        }}
        onLoadEnd={() => setLoading(false)}
        onError={(event) => {
          setLoading(false);
          setError(event.nativeEvent.description || 'Unable to load AgentOS.');
        }}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 500) {
            setError('The AgentOS server is temporarily unavailable.');
          }
        }}
        renderLoading={() => (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.message}>Loading Br3eze AgentOS…</Text>
          </View>
        )}
        renderError={() => (
          <View style={styles.center}>
            <Text style={styles.title}>AgentOS could not load</Text>
            <Text style={styles.message}>
              Check your connection, then try again. If this keeps happening,
              verify EXPO_PUBLIC_APP_URL.
            </Text>
            {!!error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity accessibilityRole="button" onPress={retry} style={styles.button}>
              <Text style={styles.buttonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
        originWhitelist={['https://*', 'http://localhost/*']}
        mixedContentMode="never"
        allowsInlineMediaPlayback
      />
      {loading && (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#2563eb" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' },
  webview: { flex: 1, backgroundColor: '#ffffff' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    backgroundColor: '#ffffff',
  },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  message: { fontSize: 15, textAlign: 'center', color: '#475569', marginTop: 12, lineHeight: 22 },
  error: { fontSize: 12, color: '#b91c1c', textAlign: 'center', marginTop: 12 },
  button: { marginTop: 20, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 22, borderRadius: 10 },
  buttonText: { color: '#ffffff', fontWeight: '700' },
  loadingOverlay: { position: 'absolute', top: 12, right: 12 },
});