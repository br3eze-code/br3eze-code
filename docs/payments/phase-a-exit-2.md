# Phase A exit

PaymentPlatform is the canonical payment boundary. PaymentGateway is compatibility-only and contains no provider implementation. PaymentService and idempotency use PaymentPlatform. Remaining runtime caller migration is Phase B.