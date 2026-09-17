# Phase A complete

The payment gateway has been reduced to a compatibility facade. Provider transport and merchant configuration are owned by PaymentPlatform and ProviderRegistry. PaymentService and idempotency are migrated to the canonical boundary. Phase B remains responsible for migrating remaining runtime callers and deleting the facade.