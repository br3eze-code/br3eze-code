package com.wifibilling.agent.agents;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

public class AuthAgent {

    private static final String PREFS_NAME = "WiFiBillingAuth";
    private static final String KEY_TOKEN = "auth_token";
    private static final String KEY_USER_ID = "user_id";
    private static final String KEY_EXPIRY = "token_expiry";

    private Context context;
    private CoreAgent coreAgent;
    private SharedPreferences prefs;
    private String apiEndpoint;
    private String apiKey;

    public AuthAgent(Context context, CoreAgent coreAgent, JSONObject config) {
        this.context = context;
        this.coreAgent = coreAgent;
        this.prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.apiEndpoint = config.optString("apiEndpoint", "");
        this.apiKey = config.optString("apiKey", "");
    }

    public void initialize() {
        // Check for existing valid token
    }

    public JSONObject authenticate(JSONObject credentials) throws JSONException {
        String username = credentials.optString("username");
        String password = credentials.optString("password");
        String deviceId = credentials.optString("deviceId");

        // In production, this would call your backend API
        // For now, simulate successful authentication

        String token = generateToken(username);
        long expiry = System.currentTimeMillis() + (24 * 60 * 60 * 1000); // 24 hours

        SharedPreferences.Editor editor = prefs.edit();
        editor.putString(KEY_TOKEN, token);
        editor.putString(KEY_USER_ID, username);
        editor.putLong(KEY_EXPIRY, expiry);
        editor.apply();

        JSONObject result = new JSONObject();
        result.put("success", true);
        result.put("token", token);
        result.put("userId", username);
        result.put("expiry", expiry);
        result.put("deviceProfiled", true);

        return result;
    }

    public JSONObject validateToken(String token) throws JSONException {
        String storedToken = prefs.getString(KEY_TOKEN, null);
        long expiry = prefs.getLong(KEY_EXPIRY, 0);

        JSONObject result = new JSONObject();

        if (storedToken == null || !storedToken.equals(token)) {
            result.put("valid", false);
            result.put("reason", "invalid_token");
        } else if (System.currentTimeMillis() > expiry) {
            result.put("valid", false);
            result.put("reason", "expired");
        } else {
            result.put("valid", true);
            result.put("userId", prefs.getString(KEY_USER_ID, null));
            result.put("expiresIn", (expiry - System.currentTimeMillis()) / 1000);
        }

        return result;
    }

    public JSONObject refreshToken() throws JSONException {
        String currentToken = prefs.getString(KEY_TOKEN, null);
        String userId = prefs.getString(KEY_USER_ID, null);

        if (currentToken == null || userId == null) {
            throw new JSONException("No active session to refresh");
        }

        // Generate new token
        String newToken = generateToken(userId);
        long newExpiry = System.currentTimeMillis() + (24 * 60 * 60 * 1000);

        SharedPreferences.Editor editor = prefs.edit();
        editor.putString(KEY_TOKEN, newToken);
        editor.putLong(KEY_EXPIRY, newExpiry);
        editor.apply();

        JSONObject result = new JSONObject();
        result.put("success", true);
        result.put("token", newToken);
        result.put("expiry", newExpiry);

        return result;
    }

    public void logout() {
        SharedPreferences.Editor editor = prefs.edit();
        editor.clear();
        editor.apply();
    }

    private String generateToken(String username) {
        return "pc-tok-" + System.currentTimeMillis() + "-" +
                android.util.Base64.encodeToString(username.getBytes(), android.util.Base64.URL_SAFE);
    }

    public void shutdown() {
        // Cleanup
    }
}