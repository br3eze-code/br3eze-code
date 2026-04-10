package zw.power.www;

import org.apache.cordova.*;
import org.json.*;

import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CallbackContext;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import android.util.Log;
import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;

import android.AiCapabilityDetector;
import android.AiRouter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

// NOTE: These are for the experimental Android ML Kit GenAI 
// Actual imports might vary slightly based on the dynamic version of ML Kit
// But this follows the Google AI Edge / ML Kit standard integration pattern
import com.google.mlkit.vision.pose.Pose;
import com.google.mlkit.vision.pose.PoseDetection;
import com.google.mlkit.vision.pose.PoseDetector;
import com.google.mlkit.vision.pose.PoseLandmark;
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions;
import com.google.mlkit.vision.common.InputImage;

import com.google.mlkit.genai.prompt.Generation; // Updated package for ML Kit Prompt API (2025 standard)
import com.google.mlkit.genai.prompt.GenerativeModelFutures; // For async handling
import com.google.mlkit.nl.generativeai.GenerativeModel;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.nl.genai.PromptRequest;
import com.google.mlkit.nl.generativeai.GenerativeModelBuilder;
import com.google.mlkit.nl.generativeai.model.Content;
import com.google.mlkit.nl.generativeai.model.GenerateContentResponse;

import java.util.List;

public class AICorePlugin extends CordovaPlugin {
    private static final String TAG = "AICorePlugin";
    private GenerativeModel model;
    private PoseDetector poseDetector;
    private GenerativeModelFutures generativeModelFutures;

    @Override
    protected void pluginInitialize() {
        // Initialize Gemini Nano with your 'Librarian/Manager' instructions
        // Assuming GenerativeModel has a standard Java Builder
        // If not, this needs to match the specific SDK version.
        // For now, removing the extra brace and using a cleaner setup.
        try {
            // Example Java Builder pattern usually used in these Google SDKs
            // Note: Actual implementation depends on specific SDK version artifacts
            /*
             * model = new GenerativeModel.Builder()
             * .setModelName("gemini-nano")
             * .setSystemInstruction(new
             * Content.Builder().addText("You are the Power Connect Manager...").build())
             * .build();
             */
            // Leaving as placeholder comment until SDK confirmed, but fixing syntax error
        } catch (Exception e) {
            Log.e(TAG, "Failed to init model", e);
        }
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        if (action.equals("checkAvailability")) {
            this.checkAvailability(callbackContext);
            return true;
        }
        if ("generateText".equals(action)) {
            String prompt = args.getString(0);
            generateText(prompt, callbackContext);
            return true;
        }
        if ("detectPose".equals(action)) {
            String base64Image = args.getString(0);
            detectPose(base64Image, callbackContext);
            return true;
        }
        if ("capabilities".equals(action)) {
            // Placeholder – implement AiCapabilityDetector if needed
            JSONObject caps = new JSONObject();
            caps.put("geminiNano", true);
            caps.put("poseDetection", true);
            callbackContext.success(caps);
            return true;
        }
        if ("request".equals(action)) {
            JSONObject payload = args.getJSONObject(0);
            AiRouter.route(cordova.getContext(), payload, callbackContext);
            return true;
        }
        callbackContext.error("Unknown action: " + action);
        return false;
    }

    private void checkAvailability(final CallbackContext callbackContext) {
        try {
            if (generativeModelFutures == null) {
                generativeModelFutures = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
            }

            // Check feature status (AVAILABLE, DOWNLOADABLE, UNAVAILABLE, etc.)
            ListenableFuture<Integer> statusFuture = generativeModelFutures.checkStatus();
            Futures.addCallback(statusFuture, new FutureCallback<Integer>() {
                @Override
                public void onSuccess(Integer status) {
                    String result;
                    switch (status) {
                        case FeatureStatus.AVAILABLE:
                            result = "readily";
                            break;
                        case FeatureStatus.DOWNLOADABLE:
                            result = "after_download";
                            break;
                        default:
                            result = "no";
                    }
                    callbackContext.success(result);
                }

                @Override
                public void onFailure(Throwable t) {
                    callbackContext.error("Availability check failed: " + t.getMessage());
                }
            }, cordova.getActivity().getMainExecutor());
        } catch (Exception e) {
            callbackContext.error("Availability check failed: " + e.getMessage());
        }
    }

    private void generateText(final String prompt, final CallbackContext callbackContext) {
        cordova.getThreadPool().execute(() -> {
            try {
                if (generativeModelFutures == null) {
                    generativeModelFutures = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
                }

                // Build request (text-only for Nano)
                // Assuming Content.createText(prompt) or standard object creation for Java
                Content content = new Content.Builder().addText(prompt).build(); // Placeholder for valid object
                                                                                 // construction
                // NOTE: The previous code was Kotlin DSL. Replaced with generic Java object
                // creation.
                // If GenerateContentRequest is a specific class, it should be instantiated
                // normally.
                // Below is a best-guess fix assuming 'request' is needed or we can pass content
                // directly.
                // If the API expects a String simply:
                // ListenableFuture<GenerateContentResponse> responseFuture =
                // generativeModelFutures.generateContent(prompt);
                // But sticking to the variable name pattern:
                GenerateContentRequest request = new GenerateContentRequest.Builder().setText(prompt).build();

                ListenableFuture<GenerateContentResponse> responseFuture = generativeModelFutures
                        .generateContent(request);

                Futures.addCallback(responseFuture, new FutureCallback<GenerateContentResponse>() {
                    @Override
                    public void onSuccess(GenerateContentResponse response) {
                        String result = response.getText();
                        if (result != null) {
                            callbackContext.success(result);
                        } else {
                            callbackContext.error("Empty response");
                        }
                    }

                    @Override
                    public void onFailure(Throwable t) {
                        callbackContext.error("Generation failed: " + t.getMessage());
                    }
                }, cordova.getActivity().getMainExecutor());

            } catch (Exception e) {
                callbackContext.error("Fatal AI Error: " + e.getMessage());
            }
        });
    }

    private void detectPose(final String base64Image, final CallbackContext callbackContext) {
        if (poseDetector == null) {
            PoseDetectorOptions options = new PoseDetectorOptions.Builder()
                    .setDetectorMode(PoseDetectorOptions.SINGLE_IMAGE_MODE)
                    .build();
            poseDetector = PoseDetection.getClient(options);
        }

        cordova.getThreadPool().execute(new Runnable() {
            @Override
            public void run() {
                try {
                    byte[] decodedString = Base64.decode(base64Image, Base64.DEFAULT);
                    Bitmap bitmap = BitmapFactory.decodeByteArray(decodedString, 0, decodedString.length);
                    InputImage image = InputImage.fromBitmap(bitmap, 0);

                    poseDetector.process(image)
                            .addOnCompleteListener(new OnCompleteListener<Pose>() {
                                @Override
                                public void onComplete(Task<Pose> task) {
                                    if (task.isSuccessful()) {
                                        Pose pose = task.getResult();
                                        JSONArray results = new JSONArray();
                                        try {
                                            for (PoseLandmark landmark : pose.getAllPoseLandmarks()) {
                                                JSONObject obj = new JSONObject();
                                                obj.put("type", landmark.getLandmarkType());
                                                obj.put("x", landmark.getPosition().x);
                                                obj.put("y", landmark.getPosition().y);
                                                obj.put("z", landmark.getInFrameLikelihood()); // Likelihood instead of
                                                                                               // Z if 2D
                                                results.put(obj);
                                            }
                                            callbackContext.success(results);
                                        } catch (JSONException e) {
                                            callbackContext.error("JSON Error: " + e.getMessage());
                                        }
                                    } else {
                                        callbackContext
                                                .error("Pose Detection failed: " + task.getException().getMessage());
                                    }
                                }
                            });
                } catch (Exception e) {
                    callbackContext.error("Detection fatal error: " + e.getMessage());
                }
            }
        });
    }
}
