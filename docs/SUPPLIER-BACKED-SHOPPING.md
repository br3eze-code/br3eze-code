# Supplier-backed shopping and provisioning

This integration lets the catalog/shopping agent expose a product's supplier reference, propose replenishment, and submit a purchase order through a configured supplier API after a persisted approval is validated by the server.

## Product document fields

Store these fields on `products/{productId}`:

```json
{
  "tenantId": "tenant-a",
  "active": true,
  "name": "Access point",
  "price": 35,
  "stock": 0,
  "supplierId": "supplier-a",
  "supplierSku": "AP-AX",
  "supplierReferenceUrl": "https://supplier.example/catalog/AP-AX",
  "supplierUnitCost": 22.5,
  "supplierCurrency": "USD",
  "supplierFulfillmentMode": "restock"
}
```

`supplierReferenceUrl` is a reference link for an agent/operator, not an API endpoint. Only HTTPS URLs without embedded credentials are accepted. Do not store supplier API tokens in product documents. `supplierUnitCost` is the procurement cost; `price` remains the customer selling price.

## Supplier and approval records

- `suppliers/{supplierId}`: must contain the matching `tenantId` and `status: "active"`.
- `users/{uid}`: must contain `tenantId` and `projectId` (or `defaultProjectId`).
- `supplierApprovals/{approvalId}`: a server-created record with `status: "APPROVED"`, matching `tenantId`, `projectId`, and `action`. Purchase orders use `action: "purchase.order"`; invoice matching uses `action: "settlement.release"`.

Only an authenticated ADMIN can approve a purchase proposal. An identity with `procurement:write` may create a proposal and perform the operations authorized by the relevant route, but cannot approve a proposal unless it also has the ADMIN role. The server verifies the persisted approval record and its tenant, project, action, and proposal association; a client-supplied approval ID alone is never sufficient. Proposal creation is idempotent for the same tenant, project, requester, and idempotency key. Reusing that key with different request details returns HTTP 409. A proposal captures server-calculated procurement details; if those details change before submission, the request must be reviewed and proposed again.

## API configuration

Set these variables on the **server only**:

- `BR3EZE_SUPPLIER_API_URL`: base URL for a trusted supplier gateway, for example `https://supplier-gateway.example/api/v1/`.
- `BR3EZE_SUPPLIER_API_TOKEN`: bearer credential for that gateway.
- `AGENTOS_API_BASE_URL`: root origin for the authenticated API client used by agent contexts.
- `PUBLIC_URL`: customer storefront origin, configured separately.

The gateway must implement `POST {BR3EZE_SUPPLIER_API_URL}/purchase-orders`, accept the `Idempotency-Key` header, and return JSON containing a non-empty `supplierOrderId`. The gateway receives `supplierId`, `orderId`, tenant, currency, and item lines including supplier SKU/reference, quantity, and unit cost. The adapter intentionally does not guess each supplier's private API. Configure a gateway/provider that knows how to route supplier IDs to their supported APIs.

## Routes

All routes below require a bearer-authenticated user and tenant/project profile.

- `GET /api/v1/shop/products/:productId/supplier-reference` — read supplier reference metadata.
- `POST /api/v1/shop/supplier-orders` — persist a purchase proposal and return `proposalId` when no `approvalId` is supplied. To submit, send the same `productId`, `quantity`, and `idempotencyKey` plus the returned `proposalId` and its approved `approvalId`; the server checks the persisted proposal and approval match before supplier submission.
- `POST /api/v1/shop/supplier-orders/:orderId/approval` — explicit ADMIN approval of a persisted pending proposal. The requester cannot approve their own proposal. Repeated proposal requests with the same idempotency key return the original proposal; reuse with changed details is rejected. The route returns the persisted `approvalId` needed for submission. The key may be sent as the `Idempotency-Key` header.
- `GET /api/v1/shop/supplier-orders/:orderId` — recover persisted state, evidence, and next action.
- `POST /api/v1/shop/supplier-orders/:orderId/receipts` — record accepted/rejected quantities and evidence; stock increments only for accepted units, in the same Firestore transaction as the receipt/order update.
- `POST /api/v1/shop/supplier-orders/:orderId/invoice-match` — compare invoice quantity and total against order/receipt state; requires settlement-release approval. This matches the invoice but does **not** itself send money.
- `POST /api/v1/shop/supplier-orders/:orderId/close` — close only when required acceptance evidence is already persisted and quantities are resolved.

Firestore stores include `supplierPurchaseOrders`, `supplierProvisioningIdempotency`, `supplierProvisioningEvents`, and `supplierReceipts`. Their document keys are tenant-scoped. Inventory updates require the product record's `tenantId` to match the caller's tenant.

## Agent wiring

Inject the provider adapters into the request-scoped specialist context:

```js
import { createSupplierProvisioningClient } from '../adapters/commerce/supplier-provisioning-client.js';

const supplierApi = createSupplierProvisioningClient({
  env: process.env,
  getAccessToken: async () => requestScopedUserAccessToken,
});

const context = {
  tenantId, userId, projectId, approval,
  services: {
    supplierCatalog: supplierApi,
    supplierProvisioning: supplierApi,
  },
};
```

The token callback must return the current authenticated user's access token; do not hard-code a user token or use a supplier API token for customer authentication.

## Important boundaries

- This is a provider-neutral gateway contract, not a claim of integration with any particular supplier.
- Supplier API credentials must be provisioned on the server's secret manager.
- The agent can read product supplier links and propose procurement. It cannot bypass persisted approval.
- A purchase order replenishes stock; it does not automatically make an out-of-stock product available for checkout before goods are received. Dropshipping/direct supplier fulfilment needs a separate provider contract and customer-order workflow.
- Run the repository CI and test suite before production use. Live supplier sandbox credentials and a provider-specific contract test are still required.
