# Runbooks

Operational guidance for recovering from failure states defined in spec
section 26 (error handling and recovery) and section 8.8 (onboarding
receipts and recovery). Populated as each failure mode is implemented and
exercised in integration tests.

Planned runbooks:
- Partial GitHub publish (repository created, push failed).
- Tool installer completed but PATH not visible (needs_restart).
- Database migration failure (mutation operations blocked).
- Native worker crash and restart policy.
