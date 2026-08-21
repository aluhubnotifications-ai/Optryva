# Optryva TODO

Pilot hardening and product completion. AI calibration is intentionally deferred.

- [ ] Finish verification
  - [x] Client build
  - [x] Server typecheck
  - [ ] Desktop and mobile flow checks in light and dark mode
- [ ] Secure resume and application documents
  - [x] Move files to private storage
  - [x] Use short-lived signed URLs
  - [x] Add file type, MIME, size, and upload-count validation
  - [x] Add document access and download auditing
  - [ ] Apply and live-test migration `0022_private_documents.sql`
- [ ] Complete auth and privacy hardening
  - [x] Remove production JWT fallbacks
  - [ ] Add authorization tests
  - [ ] Add privacy and cross-user enumeration tests
- [ ] Add loading, error, retry, and offline states
- [ ] Improve performance
  - [ ] Add route-level lazy loading
  - [ ] Defer AI matching until explicitly needed or browser idle time
- [ ] Complete Student Profile
  - [x] Treat the existing profile as an equal first résumé direction
  - [x] Start new résumé directions with the saved profile preferences
  - [ ] Add resume versioning
  - [ ] Preserve the submitted resume and application preference snapshot
- [ ] Finish matching evaluation
  - [ ] Add qualification guardrails
  - [ ] Add score-band metrics and evaluation reporting

## Deferred

- [ ] AI calibration and engagement-feedback calibration

This remains deferred until the pilot verification, security, reliability, performance,
and profile work are complete.
