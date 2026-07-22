<?php
require 'vendor/autoload.php';
require_once 'database_config.php'; // Include your config file

use \RouterOS\Client;
use \RouterOS\Query;

/**
 * Connect to MikroTik RouterOS API
 */
function connectToMikrotik() {
    return new Client([
        'host' => MT_HOST,
        'user' => MT_USER,
        'pass' => MT_PASS,
        'port' => MT_PORT ?? 8728,
    ]);
}

/**
 * Create a new hotspot user on MikroTik
 */
function createUserOnMikroTik($username, $password, $profile = 'default') {
    try {
        $client = connectToMikrotik();

        // Check if user already exists
        $checkQuery = (new Query('/ip/hotspot/user/print'))->where('name', $username);
        $existing = $client->query($checkQuery)->read();

        if (!empty($existing)) {
            return ['success' => false, 'message' => "User '{$username}' already exists."];
        }

        // Create user
        $query = (new Query('/ip/hotspot/user/add'))
            ->equal('name', $username)
            ->equal('password', $password)
            ->equal('profile', $profile);

        $client->query($query)->read();

        return ['success' => true, 'message' => "User '{$username}' created."];
    } catch (Exception $e) {
        return ['success' => false, 'message' => $e->getMessage()];
    }
}

/**
 * Updates a user's profile on the MikroTik router.
 */
function updateUserProfileOnMikroTik($username, $profile) {
    try {
        $client = connectToMikrotik();

        // Find user by name
        $query = (new Query('/ip/hotspot/user/print'))->where('name', $username);
        $user_response = $client->query($query)->read();

        if (empty($user_response)) {
            return ['success' => false, 'message' => "User '{$username}' not found."];
        }

        $user_id = $user_response[0]['.id'];

        // Update profile
        $update_query = (new Query('/ip/hotspot/user/set'))
            ->equal('.id', $user_id)
            ->equal('profile', $profile);

        $client->query($update_query)->read();

        return ['success' => true, 'message' => "User '{$username}' updated to profile '{$profile}'."];
    } catch (Exception $e) {
        return ['success' => false, 'message' => $e->getMessage()];
    }
}

/**
 * Activates a voucher and upgrades user profile.
 */
function handle_activate_voucher() {
    global $pdo;

    $username = trim($_POST['username'] ?? '');
    $code = trim($_POST['code'] ?? '');

    if (empty($username) || empty($code)) {
        echo json_encode(['success' => false, 'message' => 'Username and voucher code are required.']);
        return;
    }

    // Fetch voucher
    $stmt = $pdo->prepare("SELECT profile_name FROM vouchers WHERE code = ? AND status = 'unused'");
    $stmt->execute([$code]);
    $voucher = $stmt->fetch();

    if (!$voucher) {
        echo json_encode(['success' => false, 'message' => 'Invalid or already used voucher.']);
        return;
    }

    $profile = $voucher['profile_name'];

    // Update MikroTik
    $mikrotikResult = updateUserProfileOnMikroTik($username, $profile);

    if ($mikrotikResult['success']) {
        // Mark voucher as used
        $stmt = $pdo->prepare("UPDATE vouchers SET status = 'used', used_by_username = ? WHERE code = ?");
        $stmt->execute([$username, $code]);

        echo json_encode([
            'success' => true,
            'message' => "Voucher activated. User '{$username}' upgraded to '{$profile}'."
        ]);
    } else {
        echo json_encode(['success' => false, 'message' => $mikrotikResult['message']]);
    }
}
?>
