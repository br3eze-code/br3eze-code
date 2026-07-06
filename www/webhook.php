<?php
// File: stripe_webhook.php

// Only respond to POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST', true, 405);
    exit;
}

require 'vendor/autoload.php';
// Load our app's configuration and functions
require_once 'database_config.php'; // Provides $pdo and constants
require_once 'mikrotik_functions.php'; // Provides updateUserProfileOnMikroTik()

// Use the webhook secret from our config file
$endpoint_secret = STRIPE_WEBHOOK_SECRET;

$payload = @file_get_contents('php://input');
$sig_header = $_SERVER['HTTP_STRIPE_SIGNATURE'];
$event = null;

try {
    $event = \Stripe\Webhook::constructEvent($payload, $sig_header, $endpoint_secret);
} catch (\UnexpectedValueException $e) {
    // Invalid payload
    http_response_code(400);
    exit();
} catch (\Stripe\Exception\SignatureVerificationException $e) {
    // Invalid signature
    http_response_code(400);
    exit();
}

// Handle only the checkout.session.completed event
if ($event->type == 'checkout.session.completed') {
    $session = $event->data->object;
    $local_transaction_id = $session->metadata->local_transaction_id ?? null;
    $stripe_session_id = $session->id;

    if (!$local_transaction_id) {
        // We can't process this without our local ID
        http_response_code(400);
        exit("Error: Missing local_transaction_id in webhook metadata.");
    }

    try {
        // Use a database transaction for atomicity. All or nothing.
        $pdo->beginTransaction();

        // 1. Find the PENDING transaction in our database
        $stmt_trans = $pdo->prepare("SELECT * FROM transactions WHERE id = ? AND status = 'pending' FOR UPDATE");
        $stmt_trans->execute([$local_transaction_id]);
        $transaction = $stmt_trans->fetch(PDO::FETCH_ASSOC);

        if (!$transaction) {
            // This can happen if the webhook is sent twice.
            // If the transaction is already 'completed', we can safely ignore it.
            $pdo->rollBack();
            http_response_code(200); // Acknowledge receipt, but do nothing.
            exit("Transaction not found or already processed.");
        }
           $user_stmt = $pdo->prepare("SELECT username FROM users WHERE id = ?");
        $user_stmt->execute([$transaction['user_id']]);
        $user = $user_stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user) {
            throw new Exception("User with ID {$transaction['user_id']} not found for transaction {$local_transaction_id}.");
        }
        $username_to_update = $user['username'];

        // 2. Get the product details (specifically the MikroTik profile)
        $prod_stmt = $pdo->prepare("SELECT mikrotik_profile FROM products WHERE id = ?");
        $prod_stmt->execute([$transaction['product_id']]);
        $product = $prod_stmt->fetch();

        if (!$product) {
            throw new Exception("Product associated with transaction ID {$local_transaction_id} not found.");
        }
        
        $profile_to_set = $product['mikrotik_profile'];

        // 3. FULFILL THE ORDER: Update the user on the MikroTik router
        $mikrotikResult = updateUserProfileOnMikroTik($username_to_update, $profile_to_set);

        if (!$mikrotikResult['success']) {
            // Throw an exception if MikroTik update fails. This will trigger the catch block.
            throw new Exception("MikroTik update failed for user '{$username_to_update}': " . $mikrotikResult['message']);
        }

        // 4. MARK AS COMPLETED: Update our local transaction record
        $update_stmt = $pdo->prepare(
            "UPDATE transactions SET status = 'completed', payment_reference = ? WHERE id = ?"
        );
        // We store the Stripe Session ID as the reference.
        $update_stmt->execute([$stripe_session_id, $local_transaction_id]);

        // If all steps succeeded, commit the transaction
        $pdo->commit();

    } catch (Exception $e) {
        // Something went wrong. Roll back any database changes.
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        
        // Log the error to a file
        error_log("Webhook processing failed: " . $e->getMessage());

        // Respond with an error to make Stripe retry the webhook
        http_response_code(500);
        exit();
    }
}

// Send a 200 OK response to Stripe to acknowledge receipt of the event
http_response_code(200);