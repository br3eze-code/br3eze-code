<?php
// File: payment_success.php
header('Content-Type: application/json');

require 'vendor/autoload.php';
require_once 'database_config.php'; // Provides $pdo

$sessionId = $_GET['session_id'] ?? '';

if (empty($sessionId)) {
    http_response_code(400); // Bad Request
    echo json_encode(['success' => false, 'status' => 'error', 'message' => 'No session ID provided.']);
    exit();
}

try {
    // Query YOUR database, not Stripe's API.
    // The webhook is responsible for updating this record.
    $stmt = $pdo->prepare("SELECT status, username FROM transactions WHERE payment_reference = ?");
    $stmt->execute([$sessionId]);
    $transaction = $stmt->fetch();

    if (!$transaction) {
        http_response_code(404); // Not Found
        echo json_encode(['success' => false, 'status' => 'not_found', 'message' => 'Transaction not found.']);
    } else {
        // Return the status ('completed', 'pending', or 'failed') to the frontend.
        echo json_encode([
            'success' => $transaction['status'] === 'completed',
            'status' => $transaction['status'],
            'username' => $transaction['username']
        ]);
    }

} catch (PDOException $e) {
    http_response_code(500); // Internal Server Error
    error_log("Payment success check failed: " . $e->getMessage()); // Log error
    echo json_encode(['success' => false, 'status' => 'error', 'message' => 'A database error occurred.']);
}
?>