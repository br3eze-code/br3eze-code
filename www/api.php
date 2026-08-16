<?php
require_once __DIR__ . '/agentos_fallback.php';

require 'vendor/autoload.php';
require_once 'database_config.php'; // Provides $pdo
require_once 'mikrotik_functions.php'; // Provides MikroTik functions

// --- Main API Router ---
$action = (string) agentos_input('action', '');
$context = agentos_context(true);

try {
    switch ($action) {
        case 'check_user':
            handle_check_user();
            break;
        case 'register':
            handle_register();
            break;
        case 'activate_voucher':
            // This function is already defined in mikrotik_functions.php,
            // so we just call it.
            handle_activate_voucher();
            break;
        case 'create_payment_session':
            handle_create_payment_session();
            break;
        case 'paynow_webhook':
            // It's better to keep webhooks in a separate, dedicated file.
            // For example: include('webhook_handler.php');
            echo json_encode(['success' => true, 'message' => 'Webhook action acknowledged but not processed here.']);
            break;
        default:
            throw new Exception('Invalid action specified.');
    }
} catch (Throwable $e) {
    agentos_safe_exception($e);
}

// --- ACTION HANDLER FUNCTIONS ---
/**
 * Checks if a user exists in the database based on their email.
 * The email is used as the username.
 */
function handle_check_user() {
    global $pdo;
    $email = filter_var(trim($_POST['email'] ?? ''), FILTER_SANITIZE_EMAIL);

    if (!$email) {
        throw new Exception('Invalid email address provided.');
    }

    // Check if a user with this email (which is their username) exists
    $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    // Return a simple JSON object indicating if the user exists
    echo json_encode(['exists' => (bool)$user]);
}

/**
 * Handles new user registration in the DB and on MikroTik.
 */
function handle_register() {
    global $pdo;
    global $context;
    agentos_require_mutation_approval();
    $reg_username = $context['userId'];
    $reg_password = $_POST['reg_password'] ?? '';
    $reg_email = filter_var(trim($_POST['reg_email'] ?? ''), FILTER_SANITIZE_EMAIL);
    $reg_fullname = trim($_POST['reg_fullname'] ?? '');
    $reg_phone = trim($_POST['reg_phone'] ?? '');

    if (empty($reg_username) || empty($reg_password) || empty($reg_email)) {
        throw new Exception('Username, password, and email are required.');
    }
    if (strlen($reg_password) < 6) {
        throw new Exception('Password must be at least 6 characters long.');
    }

    // First, add the user to MikroTik with a default "guest" profile
    $mikrotikResult = createUserOnMikroTik($reg_username, $reg_password, 'default');
    if (!$mikrotikResult['success']) {
        // If it fails (e.g., user exists on router), throw an exception.
        throw new Exception($mikrotikResult['message']);
    }

    // If MikroTik creation was successful, add the user to the local database
    try {
        $password_hash = password_hash($reg_password, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare("INSERT INTO users (username, password, email, fullname, phone) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([$reg_username, $password_hash, $reg_email, $reg_fullname, $reg_phone]);

        echo json_encode(['success' => true, 
        'message' => 'Registration successful! You can now log in.',
    'username' => $reg_username]);

    } catch (PDOException $e) {
        // If DB insert fails (e.g., duplicate username/email), we should try to remove the user from MikroTik
        // to keep systems in sync. This is advanced error recovery. For now, we'll just show the error.
        if ($e->getCode() == '23000') { // 23000 is the SQLSTATE for an integrity constraint violation
            throw new Exception('This username or email is already taken.');
        } else {
            throw new Exception('A database error occurred during registration.');
        }
    }
}


/**
 * Creates a Stripe Checkout Session for a given user and product.
 */
function handle_create_payment_session() {
    global $pdo;
    global $context;
    agentos_require_mutation_approval();
    $username = $context['userId'];
    $product_id = (int) agentos_input('product_id', 0);
    $provider = agentos_provider((string) agentos_input('provider', 'stripe'));
    $idempotencyKey = agentos_idempotency_key();

    if ($product_id <= 0) {
        throw new Exception("Product ID is required.");
    }

    // 1. Fetch Product Details from DB
    $stmt = $pdo->prepare("SELECT name, price_cents, mikrotik_profile, price_id FROM products WHERE id = ?");
    $stmt->execute([$product_id]);
    $product = $stmt->fetch();

    if (!$product) {
        throw new Exception("Invalid product selected.");
    }
    if ($provider === 'stripe' && empty($product['price_id'])) {
        throw new Exception("Product is not configured for Stripe payments.");
    }

    // 2. Create a 'pending' transaction record
    $trans_stmt = $pdo->prepare(
        "INSERT INTO transactions (username, product_id, amount_cents, payment_method, status, idempotency_key) VALUES (?, ?, ?, ?, 'pending', ?)"
    );
    $trans_stmt->execute([$username, $product_id, $product['price_cents'], $provider, $idempotencyKey]);
    $transaction_id = $pdo->lastInsertId();

    // 3. Create the Stripe Session
    if ($provider !== 'stripe') {
        throw new Exception('Only the configured Stripe checkout adapter is available in this PHP fallback.');
    }
    \Stripe\Stripe::setApiKey(getenv('STRIPE_SECRET_KEY') ?: '');
    $checkout_session = \Stripe\Checkout\Session::create([
        'payment_method_types' => ['card'],
        'line_items' => [[
            'price' => $product['price_id'],
            'quantity' => 1,
        ]],
        'mode' => 'payment',
        'success_url' => rtrim(getenv('AGENTOS_BASE_URL') ?: '', '/') . '/payment_success.php?session_id={CHECKOUT_SESSION_ID}',
        'cancel_url' => rtrim(getenv('AGENTOS_BASE_URL') ?: '', '/') . '/login.html',
        'client_reference_id' => $username, // Authenticated AgentOS identity, not request-body input
        'metadata' => [
            'local_transaction_id' => $transaction_id,
            'tenant_id' => $context['tenantId'],
            'site_id' => $context['siteId'],
            'idempotency_key' => $idempotencyKey
        ]
    ]);

    // 4. Update our transaction record with Stripe's reference ID
    $update_stmt = $pdo->prepare("UPDATE transactions SET payment_reference = ? WHERE id = ?");
    $update_stmt->execute([$checkout_session->id, $transaction_id]);

    // 5. Return the session URL to the frontend
    echo json_encode([
        'success' => true,
        'checkout_url' => $checkout_session->url
    ]);
}

?>