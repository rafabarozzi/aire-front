# Repository connection checks

Connections accepts pasted GitHub App private keys or a local `.pem` import (PKCS1/PKCS8, maximum 8 KB). Import populates the existing write-only credential form; saving uses the same encrypted integration storage. The UI never retrieves stored private keys.

Each repository displays its persisted, tenant-scoped validation result, last check, default branch and commit. Ready means repository metadata and the default revision are readable; it does not assert analysis completion, source archive download success or operational readiness.

While Connections is open for a connection manager, the visible page checks stale repositories sequentially, separated by one second. Results expire after 15 minutes; the page checks for expiry once per minute. Hidden pages do not initiate provider checks. This is not a server scheduler: closing the page stops automatic validation. Read-only users can consult stored results. The manual Validate button forces a fresh check with an inline pending/success/failure result. Concurrent checks for the same tenant/repository/configuration share one request per server process.

GET `/api/console/connections/repository-health` reads authorized repository statuses. POST to that endpoint accepts `{repository, force?: boolean}` and requires `connections:manage`, same-origin checks and repository authorization. Stored results include no credential or provider error body. Configuration revisions and environment credential changes invalidate prior results. Changes to repositories or credentials never bypass the existing mapping-time authorization check.
