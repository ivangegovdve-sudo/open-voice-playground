# Future Azure inference budget

Azure-hosted inference is a future optional experiment, not part of the 426-preset launch catalog.
The checked-in `future-azure-inference` feature flag is deliberately hard-disabled with:

- server-only credentials required;
- terms review not cleared;
- monthly budget: USD 0;
- spend hard stop: enabled;
- character limit: 0;
- spend limit: USD 0.

No client code contains an Azure key, and no request path exists in the current runtime registry.

Enabling a small paid budget later requires a separate reviewed change that:

1. records the supported product/API and completes its service, privacy, output, and redistribution
   terms review;
2. keeps credentials in a server-only secret store and adds authenticated, rate-limited mediation;
3. sets explicit per-request and per-user character caps;
4. sets both a small monthly spend ceiling and a lower alert threshold;
5. enforces the hard stop independently of UI state, with fail-closed cost accounting;
6. exposes clear cost/online-processing consent before a request;
7. adds abuse controls, structured redaction-safe telemetry, and deletion/retention rules;
8. verifies that the online result is never represented as local, browser-only, or free inference.

The default must remain zero-cost and disabled. A future budget is an opt-in product decision, never
an automatic fallback when local inference is unavailable.
