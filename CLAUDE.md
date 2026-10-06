# SenseBeen: standing context for Claude

Distilled from the SenseBeen Website Design Spec v1.0 (2026-09-22, Drive: `SenseBeen-Website-Design-Spec.pdf`) and the Ecosystem Partnership Plan (Sept 2026). Where the spec and this repo's code disagree on site/brand matters, the spec wins; this repo itself is the Doogee/Postiz capture node plus the PQC smoke test and run-report tooling.

## Claim boundaries (non-negotiable, applies to code, docs, commit messages, README)
- Never claim FIPS 140-3 validation, certification, accreditation, third-party cryptographic verification, or "world first".
- Post-quantum signing (ML-DSA-65 / ML-KEM-768) is always labeled **IN TESTING**; signature security is described as internally tested. `pqc/` is a provider/readiness check only; the app has no PQC code path.
- Never describe SenseBeen as a certified or official partner of any company (Anthropic, Windmill, Neo4j, Forgejo/Codeberg) until granted in writing.
- Never invent statistics, client names, hashes, CIDs, dates, signers. Non-live data is labeled SAMPLE with obviously fictional values (example.com, 2026-XX-XX).
- E-Sign and x402 payments are separate products; never imply a payment settlement binds a signature attestation.
- Applications and demos use sample or consented data only and disclose no proprietary protocol detail.

## Voice
Plain, specific, technical without jargon; short declarative sentences; explicit about what is in testing. No em dashes, emoji, exclamation marks, or hype words (revolutionary, seamless, cutting-edge). Tagline: "Proof-first operations. Every deployment documented. Every claim verifiable."

## Stack and sovereignty
Self-hosted by default (Nextcloud "SenseBeen Cloud", Proof Ledger API at ledger.sensebeen.com, DocuSeal, Windmill, Forgejo). Managed services (e.g. Neo4j Aura credits) are for dev/demo only; the graph/record of truth stays self-hosted. Site: Next.js 16 / Tailwind v4 / shadcn on Vercel (separate v0 project, preview first, publish only on owner approval).

## Open items (as of 2026-09-22)
Founder photo/bio; Cloud and E-Sign pilot terms and pricing (show none); public launch of cloud./ledger.sensebeen.com; real published ledger entries for the 2024 Ghana, US and Pakistan events.

## Run reports
Giles and Divya run `scripts/run-and-report` (see README). Divya is Independent Assurance Reviewer for the endpoint-to-endpoint post-quantum run; reports must stay free of hostnames, IPs, serials, GPS, paths and `postiz.env`.
