# Server order tracking

The Node server exposes order tracking from the Firestore `orders` collection. It does not create a second order store.

## Routes

- `GET /api/v1/orders/:orderId/tracking` — authenticated. Customers can read their own order; privileged staff roles can read orders within their tenant.
- `POST /api/v1/orders/:orderId/tracking/refresh` — authenticated logistics/admin/merchant/fulfillment/support role. Queries the configured courier adapter, persists the normalized latest status and recent events, and returns the tracking view.

Both routes return 404 for missing or out-of-scope orders to avoid leaking order existence.

## Resend email

Configure on the server only:

```dotenv
EMAIL_ENABLED=true
EMAIL_FROM=no-reply@your-verified-domain.example
EMAIL_REPLY_TO=
RESEND_API_KEY=re_...
ORDER_TRACKING_BASE_URL=https://br3eze.africa
```

The sender domain must be verified in Resend. Keep `RESEND_API_KEY` out of browser/mobile builds and source control. Email is sent only when a courier refresh changes the fulfillment status and an email address is available on the order or its linked `users/{userId}` record. The Resend request uses an idempotency key derived from order ID and resulting status. A delivery failure does not roll back a courier status update.

## Current boundary / follow-up

- Shipment creation remains in the existing commerce/courier workflow; these routes track an already-attached `order.courier.provider` and `order.courier.trackingId`.
- The API uses the authenticated identity and existing tenant/user fields. Legacy orders without `userId` or tenant metadata are not exposed to ordinary customers.
- This server API does not itself implement a public, unauthenticated tracking page. The web/PWA customer tracking screen must call the authenticated endpoint using the customer's session.
- Courier adapter credentials and actual carrier API responses must be verified in the deployment environment.
- Automated tests were added; run the repository's configured test suite before production enablement.
