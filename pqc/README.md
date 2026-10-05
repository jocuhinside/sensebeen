# PQC smoke test

This directory contains a reproducible post-quantum cryptography smoke test
for the SenseBeen development environment.

Run it from the repository root:

```bash
./pqc/pqc-smoke-test.sh
```

The test uses the system OpenSSL provider to verify:

- ML-KEM-768 key generation, encapsulation, decapsulation, and shared-secret equality.
- ML-DSA-65 key generation, signing, and signature verification.

This is an environment/provider check. The current repository does not contain
an application PQC implementation, TLS endpoint, or PQC protocol integration,
so a passing run does not certify the Postiz/Doogee application.

## Suggested collaborative run

Divya can review the algorithm choices and expected cryptographic behavior.
Giles can run the script on the target host and attach the OpenSSL version and
result to the implementation or deployment notes.
