package zw.power.www;

import android.content.*;
import android.content.pm.PackageManager;
import org.json.*;

public class AiCapabilityDetector {

    public static JSONObject detect(Context ctx) throws JSONException {
        JSONObject out = new JSONObject();
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        ((ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(mi);

        boolean hasNano = hasGeminiNano(ctx);
        boolean hasGMS = hasPackage(ctx, "com.google.android.gms");
        boolean isHuawei = hasPackage(ctx, "com.huawei.hwid");

        long totalRamGb = mi.totalMem / 1073741824L; // Bytes to GB
        out.put("offline", hasNano);
        out.put("hw_profile", new JSONObject()
                .put("ram_gb", totalRamGb)
                .put("low_ram_device", totalRamGb < 4) // Critical for Zimbabwean budget phones
        );
        out.put("local", true); // Flash proxy assumed
        out.put("cloud", true);

        JSONObject vision = new JSONObject();
        vision.put("qr", true);
        vision.put("ocr", true);

        out.put("vision", vision);
        out.put("llm", new JSONObject()
                .put("nano", hasNano)
                .put("flash", true)
                .put("cloud", true));
        out.put("ecosystem", isHuawei ? "hms" : "gms");
        return out;
    }

    private static boolean hasGeminiNano(Context ctx) {
        return ctx.getPackageManager()
                .hasSystemFeature("com.google.android.feature.AI_CORE");
    }

    private static boolean hasPackage(Context ctx, String pkg) {
        try {
            ctx.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
