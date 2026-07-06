<?php
// File: payment_success.php
header('Content-Type: application/json');

require 'vendor/autoload.php';
require_once 'database_config.php'; // Provides $pdo

$sessionId = $_GET['session_id'] ?? '';

if (empty($sessionId)) {
    http_response_code(400); // Bad Request
    echo json_encode(['success' => false, 'message' => 'No session ID provided.']);
    exit();
}

try {
       $sql = "
        SELECT 
            t.status, 
            u.username 
        FROM 
            transactions t
        INNER JOIN 
            users u ON t.user_id = u.id
        WHERE 
            t.payment_reference = ?
    ";
    // Query YOUR database, not Stripe's API.
    // The webhook is responsible for updating this record.
    $stmt = $pdo->prepare("SELECT status, username FROM transactions WHERE payment_reference = ?");
    $stmt->execute([$sessionId]);
    $transaction = $stmt->fetch();

    if (!$transaction) {
        http_response_code(404); // Not Found
        echo json_encode(['success' => false, 'status' => 'not_found', 'message' => 'Transaction not found.']);
    } else {
        // This allows the frontend to know the status and react accordingly.
        // e.g., if 'pending', it can show "Processing..." and check again in 2 seconds.
        echo json_encode([
            'success' => $transaction['status'] === 'completed',
            'status' => $transaction['status'], // 'completed', 'pending', or 'failed'
            'username' => $transaction['username']
        ]);
    }

} catch (PDOException $e) {
    http_response_code(500); // Internal Server Error
    // In production, log the error message instead of echoing it.
    echo json_encode(['success' => false, 'status' => 'error', 'message' => 'Database error.']);
}
?>