package zw.power.www.models;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * AiResponse
 * 
 * A simple, reusable POJO to represent standardized AI responses
 * from the native Android plugin back to JavaScript.
 * 
 * This mirrors the JSON structure used in AiRouter and AICorePlugin:
 * {
 * "ok": true/false,
 * "task": "original prompt/task",
 * "source": "nano" | "local" | "heuristic" | "nano_downloadable" | etc.,
 * "text": "generated response text",
 * "confidence": 0.0 - 1.0,
 * "error": "optional error message" // only when ok == false
 * }
 * 
 * Using a dedicated model class improves type safety, readability,
 * and makes future extensions (e.g., adding tokens_used, latency, etc.) easier.
 */
public class AiResponse {
    private boolean ok;
    private String task;
    private String source;
    private String text;
    private double confidence;
    private String error; // null when ok == true

    public AiResponse(boolean ok, String task, String source, String text, double confidence) {
        this.ok = ok;
        this.task = task;
        this.source = source;
        this.text = text;
        this.confidence = confidence;
        this.error = null;
    }

    public AiResponse(boolean ok, String task, String source, String error) {
        this.ok = ok;
        this.task = task;
        this.source = source;
        this.text = null;
        this.confidence = 0.0;
        this.error = error;
    }

    // ---------- Getters ----------
    public boolean isOk() {
        return ok;
    }

    public String getTask() {
        return task;
    }

    public String getSource() {
        return source;
    }

    public String getText() {
        return text;
    }

    public double getConfidence() {
        return confidence;
    }

    public String getError() {
        return error;
    }

    /**
     * Converts this object to a JSONObject suitable for Cordova callback
     * success/error.
     */
    public JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("ok", ok);
        json.put("task", task);
        json.put("source", source);

        if (ok) {
            json.put("text", text != null ? text : "");
            json.put("confidence", confidence);
        } else {
            json.put("error", error != null ? error : "Unknown error");
        }

        return json;
    }

    /**
     * Static helper to create success response (used in AiRouter)
     */
    public static AiResponse success(String task, String source, String text, double confidence) {
        return new AiResponse(true, task, source, text, confidence);
    }

    /**
     * Static helper to create error response
     */
    public static AiResponse error(String task, String source, String errorMessage) {
        return new AiResponse(false, task, source, errorMessage);
    }
}
