# Security policy

Compliance Engine is a reference project, not a production system. There is no independent audit yet.
The known weaknesses are listed in [`docs/security-review.md`](docs/security-review.md); please read it
before reporting, since many findings are already known and tracked.

## Reporting a vulnerability

Report new findings **privately**, not in a public issue:

- Use GitHub's **"Report a vulnerability"** button on the repository's Security tab (private vulnerability
  reporting).
- If that is not available, open a public issue that says only that you have a security finding and
  asks for a private channel. Do not put details, proof-of-concept code or exploit steps in it.

Please include which file or circuit is affected, what an attacker can do, and how to reproduce it.
We aim to acknowledge a report within a week. This is a small team, so there is no guaranteed fix time
and no bug bounty.

## What counts

- Anything that lets a proof verify when it should not (soundness), or hides a real failure.
- Leaks of private inputs, keys or seeds, in code, logs or documentation.
- Mismatches between the TypeScript reference implementation and the Compact circuits.
- Errors in the claims made in `docs/`.

Out of scope: the Midnight network, compiler and proof server themselves (report those to the Midnight
project), and the test wallets and keys published as examples for the local network.

## Never commit

Secrets, seeds, API tokens, personal data, real sanctions-list subjects or customer data
(see `CONTRIBUTING.md`).
