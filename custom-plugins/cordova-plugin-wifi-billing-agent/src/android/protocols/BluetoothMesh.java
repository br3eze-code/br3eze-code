package com.wifibilling.agent.protocols;

import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.Context;
import android.os.ParcelUuid;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class BluetoothMesh {
    private static final String TAG = "BluetoothMesh";
    private static final UUID SERVICE_UUID = UUID.fromString("0000aaaa-0000-1000-8000-00805f9b34fb");
    private static final UUID CHARACTERISTIC_UUID = UUID.fromString("0000bbbb-0000-1000-8000-00805f9b34fb");

    private Context context;
    private GossipNode gossipNode;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner scanner;
    private BluetoothLeAdvertiser advertiser;
    private ConcurrentHashMap<String, BluetoothGatt> connectedPeers = new ConcurrentHashMap<>();

    public BluetoothMesh(Context context, GossipNode gossipNode) {
        this.context = context;
        this.gossipNode = gossipNode;
        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        this.bluetoothAdapter = manager.getAdapter();
    }

    public void initialize() {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) return;
        this.scanner = bluetoothAdapter.getBluetoothLeScanner();
        this.advertiser = bluetoothAdapter.getBluetoothLeAdvertiser();
        startAdvertising();
        startScanning();
    }

    private void startAdvertising() {
        AdvertiseSettings settings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setConnectable(true)
                .setTimeout(0)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
                .build();

        AdvertiseData data = new AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .addServiceUuid(new ParcelUuid(SERVICE_UUID))
                .build();

        advertiser.startAdvertising(settings, data, new AdvertiseCallback() {
            @Override public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                Log.d(TAG, "BLE advertising started");
            }
        });
    }

    private void startScanning() {
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();

        ScanFilter filter = new ScanFilter.Builder()
                .setServiceUuid(new ParcelUuid(SERVICE_UUID))
                .build();

        java.util.List<ScanFilter> filters = new java.util.ArrayList<>();
        filters.add(filter);

        scanner.startScan(filters, settings, new ScanCallback() {
            @Override public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice device = result.getDevice();
                if (!connectedPeers.containsKey(device.getAddress())) {
                    connectToPeer(device);
                }
            }
        });
    }

    private void connectToPeer(BluetoothDevice device) {
        device.connectGatt(context, false, new BluetoothGattCallback() {
            @Override public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    gatt.discoverServices();
                    connectedPeers.put(device.getAddress(), gatt);
                }
            }
            @Override public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                // GATT services discovered
            }
            @Override public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic charac) {
                try {
                    JSONObject json = new JSONObject(new String(charac.getValue()));
                    gossipNode.handleIncomingMessage(device.getAddress(), json);
                } catch (JSONException e) {
                    Log.e(TAG, "Failed to parse BLE message", e);
                }
            }
        });
    }

    public void send(String peerId, JSONObject message) {
        // Implement characteristic write for sending
        BluetoothGatt gatt = connectedPeers.get(peerId);
        if (gatt == null) return;
        BluetoothGattService service = gatt.getService(SERVICE_UUID);
        if (service == null) return;
        BluetoothGattCharacteristic charac = service.getCharacteristic(CHARACTERISTIC_UUID);
        if (charac == null) return;
        charac.setValue(message.toString().getBytes());
        gatt.writeCharacteristic(charac);
    }

    public void shutdown() {
        if (advertiser != null) advertiser.stopAdvertising(null);
        if (scanner != null) scanner.stopScan(null);
        for (BluetoothGatt gatt : connectedPeers.values()) gatt.disconnect();
    }
}
