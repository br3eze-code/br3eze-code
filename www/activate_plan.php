<?php
// Set header to return JSON
header('Content-Type: application/json');

// --- Include the Composer autoloader to load the API client ---
require 'vendor/autoload.php';
// Place config.php outside your public web directory for security
$config = require '/myFirstApp/www/config.php';

use \RouterOS\Client;
use \RouterOS\Query;

// --- Database Connection ---
$db_host = "localhost";
$db_user = "root";
$db_pass = "";
$db_name = "hotspot_db"; // Your user database

$conn = new mysqli($db_host, $db_user, $db_pass, $db_name);
if ($conn->connect_error) {
    echo json_encode(['success' => false, 'message' => 'Error: Cannot connect to database.']);
    exit();
}

// --- MikroTik Connection Details ---
$mt_host = '192.168.1.53'; // YOUR ROUTER'S IP
$mt_user = 'bhara'; // The API user you created
$mt_pass = 'ilovesiphoe2003'; // The API password

// --- Get Data from the AJAX request ---
$username_to_update = $_POST['username'] ?? '';
$voucher_code = $_POST['code'] ?? '';

if (empty($username_to_update) || empty($voucher_code)) {
    echo json_encode(['success' => false, 'message' => 'Please provide a username and voucher code.']);
    exit();
}

// --- 1. Validate the Voucher in the Database ---
$stmt = $conn->prepare("SELECT profile_name FROM vouchers WHERE code = ? AND status = 'unused'");
$stmt->bind_param("s", $voucher_code);
$stmt->execute();
$result = $stmt->get_result();

if ($result->num_rows === 1) {
    throw new \Exception('Invalid or already used voucher code.');
    }
    $voucher = $result->fetch_assoc();
    $profile_to_set = $voucher['profile_name']; // This will be '7D' for our example
    $stmt->close();
    // --- 2. Connect to MikroTik and Update User ---
    try {
        $client = new Client(['host' => $mt_host, 'user' => $mt_user, 'pass' => $mt_pass]);

        // Find the user to get their internal .id
        $query = (new Query('/ip/hotspot/user/print'))
            ->where('name', $username_to_update);
        
        $user_response = $client->query($query)->read();

        if (empty($user_response)) {
            echo json_encode(['success' => false, 'message' => "Username '{$username_to_update}' not found on router."]);
            exit();
        }

        $user_id = $user_response[0]['.id'];

        // Now, update the user using their .id
        $update_query = (new Query('/ip/hotspot/user/set'))
            ->equal('.id', $user_id)
            ->equal('profile', $profile_to_set);
            
        $client->query($update_query)->read();

        // --- 3. Mark Voucher as Used in Database ---
        $stmt_update = $conn->prepare("UPDATE vouchers SET status = 'used', date_used = NOW(), used_by_username = ? WHERE code = ?");
        $stmt_update->bind_param("ss", $username_to_update, $voucher_code);
        $stmt_update->execute();

        // --- 4. Success! ---
        echo json_encode(['success' => true, 'message' => "Success! Plan '{$profile_to_set}' has been activated for {$username_to_update}."]);

    } catch (\Exception $e) {
        // Handle API connection or command errors
        echo json_encode(['success' => false, 'message' => 'Router API Error: ' . $e->getMessage()]);
    }

 else {
    // Voucher is invalid or already used
    echo json_encode(['success' => false, 'message' => 'Invalid or already used voucher code.']);
}
 $stmt_update = $conn->prepare("UPDATE vouchers SET status = 'used', date_used = NOW(), used_by_username = ? WHERE code = ?");
    $stmt_update->bind_param("ss", $username_to_update, $voucher_code);
    $stmt_update->execute();
    $stmt_update->close();

    // --- 4. If all went well, commit the transaction ---
    $conn->commit();

    // --- 5. Success! ---
    $safe_profile = htmlspecialchars($profile_to_set, ENT_QUOTES, 'UTF-8');
    $safe_username = htmlspecialchars($username_to_update, ENT_QUOTES, 'UTF-8');
    echo json_encode(['success' => true, 'message' => "Success! Plan '{$safe_profile}' has been activated for {$safe_username}."]);

catch (\Exception $e) {
    // --- If anything failed, roll back the transaction ---
    $conn->rollback();

    // Log the real error for debugging
    error_log("Voucher Redemption Failed: " . $e->getMessage());

    // Send a safe, generic error to the user
    // We can show the exception message if it's one of our "safe" messages
    $safe_messages = ['Invalid or already used voucher code.', "Username '{$username_to_update}' not found on router."];
    if (in_array($e->getMessage(), $safe_messages, true) || strpos($e->getMessage(), 'not found on router') !== false) {
         echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    } else {
         echo json_encode(['success' => false, 'message' => 'An unexpected error occurred. Please try again.']);
    }

} finally {
    // --- Always close the connection ---
    $conn->close();
}
$stmt->close();
$conn->close();
?>