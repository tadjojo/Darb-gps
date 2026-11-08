# Authorization revocation acceptance checklist

Run with at least two API replicas connected to the same PostgreSQL database.

- [ ] Logging out a JWT disconnects all sockets using that JTI on every replica.
- [ ] A second login for the same user (different JTI) stays connected.
- [ ] Revoking a vehicle member removes their sockets from that vehicle room on every replica.
- [ ] The same user remains connected to other vehicle rooms where membership is active.
- [ ] A missed PostgreSQL notification is repaired by the periodic authorization audit within the expected interval.
- [ ] Disabled accounts are disconnected by the periodic audit.
- [ ] Manager/owner authorization boundaries are enforced by the membership revocation endpoint.
- [ ] Repeated notifications are idempotent.
- [ ] Cleanup removes only expired deny-list rows and refresh sessions beyond the documented 90-day window.
