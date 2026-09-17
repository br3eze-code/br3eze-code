# Phase A summary

PaymentPlatform is now the canonical provider boundary. PaymentGateway contains no provider implementations and exists only as a temporary compatibility facade. PaymentService and payment idempotency use the canonical platform. Remaining runtime references are explicitly deferred to Phase B so the facade is not removed prematurely.