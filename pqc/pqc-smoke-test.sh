#!/usr/bin/env bash
set -euo pipefail

# Reproducible PQC environment smoke test for the SenseBeen repository.
# This validates the host crypto provider; it does not claim that the
# application itself implements PQC.

command -v openssl >/dev/null || {
  echo "ERROR: openssl is required" >&2
  exit 1
}

tmpdir=$(mktemp -d)
# The keys below are one-run test keys; dispose of them however the script exits.
# Set PQC_KEEP_ARTIFACTS=1 to keep the directory for debugging (it then holds PRIVATE test keys).
trap '[ "${PQC_KEEP_ARTIFACTS:-0}" = 1 ] || rm -rf "$tmpdir"' EXIT
printf 'SenseBeen PQC smoke test\n' > "$tmpdir/message.txt"

echo "PQC smoke test"
openssl version

echo "[1/2] ML-KEM-768 encapsulation/decapsulation"
openssl genpkey -algorithm ML-KEM-768 -out "$tmpdir/kem-priv.pem" >/dev/null 2>&1
openssl pkey -in "$tmpdir/kem-priv.pem" -pubout -out "$tmpdir/kem-pub.pem" >/dev/null 2>&1
openssl pkeyutl -encap \
  -inkey "$tmpdir/kem-pub.pem" -pubin \
  -out "$tmpdir/kem-ciphertext.bin" \
  -secret "$tmpdir/kem-secret-enc.bin" >/dev/null 2>&1
openssl pkeyutl -decap \
  -inkey "$tmpdir/kem-priv.pem" \
  -in "$tmpdir/kem-ciphertext.bin" \
  -secret "$tmpdir/kem-secret-dec.bin" >/dev/null 2>&1
cmp "$tmpdir/kem-secret-enc.bin" "$tmpdir/kem-secret-dec.bin"
echo "PASS: ML-KEM-768 shared secret matched"

echo "[2/2] ML-DSA-65 signing/verification"
openssl genpkey -algorithm ML-DSA-65 -out "$tmpdir/dsa-priv.pem" >/dev/null 2>&1
openssl pkey -in "$tmpdir/dsa-priv.pem" -pubout -out "$tmpdir/dsa-pub.pem" >/dev/null 2>&1
openssl pkeyutl -sign \
  -in "$tmpdir/message.txt" \
  -inkey "$tmpdir/dsa-priv.pem" \
  -out "$tmpdir/message.sig" >/dev/null 2>&1
openssl pkeyutl -verify \
  -in "$tmpdir/message.txt" \
  -inkey "$tmpdir/dsa-pub.pem" -pubin \
  -sigfile "$tmpdir/message.sig" >/dev/null 2>&1
echo "PASS: ML-DSA-65 signature verified"

echo "RESULT: PASS"
if [ "${PQC_KEEP_ARTIFACTS:-0}" = 1 ]; then
  echo "Artifacts kept at: $tmpdir (contains one-run PRIVATE test keys; delete when done)"
else
  echo "One-run test keys disposed."
fi
