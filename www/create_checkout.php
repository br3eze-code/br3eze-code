<?php
//file: create-checkout.php
require 'vendor/autoload.php';
require_once 'database_config.php';

// --- Database Connection ---
$conn = new mysqli("localhost", "root", "", "hotspot_db");
if ($conn->connect_error) {
    die("Database Connection Failed.");
}

// --- Paynow Setup ---
// Replace with your REAL secret key in production
\Paynow\Paynow::setApiKey('sk_test_YOUR_SECRET_KEY'); 

// --- Get Data from Form ---
$product_id = $_POST['product_id'] ?? 0;
$username = $_POST['username'] ?? '';

if (empty($product_id) || empty($username)) {
    die("Error: Missing product or username.");
}

// --- Fetch Product Details from DB ---
$stmt = $conn->prepare("SELECT price_id FROM products WHERE id = ?");
$stmt->bind_param("i", $product_id);
$stmt->execute();
$result = $stmt->get_result();
if ($result->num_rows === 0) {
    die("Error: Invalid product selected.");
}
$product = $result->fetch_assoc();
$price_id = $product['price_id'];

// --- Create Paynow Checkout Session ---
try{
$checkout_session = \Paynow\Checkout\Session::create([
    'payment_method_types' => ['card'],
    'line_items' => [[
        'price' => $price_id,
        'quantity' => 1,
    ]],
    'mode' => 'payment',
    'success_url' => 'http://localhost/Br3eze/payment_success.html?session_id={CHECKOUT_SESSION_ID}',
    'client_reference_id' => $username,
    'cancel_url' => 'http://localhost/Br3eze/index.html',
    'client_reference_id' => $username, // IMPORTANT: This links the payment to your hotspot user
'metadata' => [
            'local_transaction_id' => $transaction_id // Also pass our local transaction ID
        ]
    ]);
  // Update our transaction record with Paynow's reference ID
    $update_stmt = $pdo->prepare("UPDATE transactions SET payment_reference = ? WHERE id = ?");
    $update_stmt->execute([$checkout_session->id, $transaction_id]);

// --- Redirect to Paynow ---
header("HTTP/1.1 303 See Other");
header("Location: " . $checkout_session->url);
} catch (\Paynow\Exception\ApiErrorException $e) {
    // Handle potential Paynow API errors
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Could not create payment session: ' . $e->getMessage()]);
    exit();
}