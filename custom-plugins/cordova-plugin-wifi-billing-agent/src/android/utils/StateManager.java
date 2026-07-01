package com.wifibilling.agent.utils;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONException;
import org.json.JSONObject;

public class StateManager {
    private static final String PREFS_NAME = "WiFiBillingPrefs";
    private static StateManager instance;
    private SharedPreferences prefs;

    private StateManager() {}

    public static synchronized StateManager getInstance() {
        if (instance == null) instance = new StateManager();
        return instance;
    }

    public void initialize(Context context, JSONObject config) {
        this.prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public void saveString(String key, String value) {
        prefs.edit().putString(key, value).apply();
    }

    public String getString(String key, String defaultValue) {
        return prefs.getString(key, defaultValue);
    }

    public void saveJSONObject(String key, JSONObject value) {
        saveString(key, value.toString());
    }

    public JSONObject getJSONObject(String key) {
        String val = getString(key, null);
        if (val == null) return null;
        try {
            return new JSONObject(val);
        } catch (JSONException e) {
            return null;
        }
    }
}
