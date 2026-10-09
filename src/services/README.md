# Services boundary

Services contain application/domain logic and may depend on Core contracts, persistence interfaces, and adapters supplied by the host. Core/kernel code must not import concrete services.

Concrete infrastructure implementations belong in `src/adapters/**`; reusable extension packages belong in `src/plugins/**`.

Use `ServiceRegistry` for explicit dependency injection and lifecycle management rather than constructing services from Core.
