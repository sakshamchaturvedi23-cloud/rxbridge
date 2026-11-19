# RxBridge — Engineering Source of Truth

> **AI Agent Rule (Paste in every prompt):**
> Read `SOURCE_OF_TRUTH.md`, `schema.sql`, `src/types/database.types.ts`, and `src/types/contracts.ts` before writing code. Do NOT edit files outside my assigned folders or modify DB schema without P3's approval.

## 1. Stack & Deployment
- **Single Repo:** Next.js (App Router) + TypeScript + Tailwind CSS + Supabase (Postgres, Auth, Storage)
- **Deploy:** Vercel (Hobby plan, Fluid Compute enabled). Set `export const maxDuration = 60;` on `/api/extract`.
- **Upload Rule:** Never POST raw >4MB phone photos to Next.js API routes (Vercel 4.5 MB body limit). Compress on client (<1 MB) or upload to private Supabase Storage (`prescriptions` / `reports`) first and pass `storage_path` to the API route.

## 2. Folder & Shared Ownership (Zero Conflicts)
- **P1 (Patient UI + Shared Shell Owner):**
  - Owns: `src/app/layout.tsx`, `src/components/shared/` (navbar, auth/login, badges), `src/app/(patient)/`, `src/components/patient/`
- **P2 (AI Extraction, Clinical Rules & Data):**
  - Owns: `src/app/api/extract/`, `src/app/api/safety/`, `src/app/api/search/`, `src/lib/clinical/`, `scripts/` (one-time Kaggle cleaning)
- **P3 (Shops, Optimizer, Pharmacist Ops + DB Schema Owner):**
  - Owns: `schema.sql` (migrations), `src/app/api/plans/`, `src/app/api/reservations/`, `src/app/(pharmacist)/`, `src/components/pharmacist/`, `src/lib/optimizer/`
  - **Schema Rule:** Only P3 modifies `schema.sql`, runs migrations in Supabase, regenerates `src/types/database.types.ts` (`npx supabase gen types typescript --remote=hjjnanwlcerxapeugama > src/types/database.types.ts`), and notifies P1 & P2 to pull.

## 3. Data & Clinical Guardrails
- **Catalog Size:** 500–1,000 active Indian outpatient medicines (verify Kaggle dataset license). Manually verify at least 50 high-frequency entries.
- **NTI (Do-Not-Substitute):** Curated manually (20–30 drugs: thyroid, epilepsy, blood thinners, etc.) from a reliable clinical reference. Never AI-guessed blindly.
- **Schedule H:** Verified against official Indian Drugs & Cosmetics Rules. Requires prescription or pharmacist verification before reserve.
- **Demo Cache:** Pre-cache OCR responses for the 5 demo prescriptions (keyed by filename/hash or toggle) so demo works even if Wi-Fi/LLM fails.
- **Mandatory Labels:** Always display `"Patient-uploaded, unverified"` on user profiles/reports/QRs, `"Simulated"` / `"Pharmacy-reported"` / `"Confirmed"` on stock, and decision-support disclaimers on safety alerts.

## 4. Production-Grade Security & Git Rules
- **Strict RLS Enabled:** Every table has Row-Level Security enabled (see `schema.sql`). Always query using the authenticated user's Supabase client on the frontend.
- **Private Storage + Signed URLs:** `prescriptions` and `reports` buckets are PRIVATE. Always store files at `${user.id}/${fileName}` and generate short-lived signed URLs (`createSignedUrl`, 300s) server-side for OCR and pharmacist verification.
- **Cross-User Flows via Server API Only:** Pharmacist viewing a reserved prescription, QR doctor share (validating `share_tokens.expires_at > now()`), and writing to `ocr_aliases` must happen inside `src/app/api/*` after verifying authorization—never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser or prefix it with `NEXT_PUBLIC_`.
- **Branches & Rollback:** Work only on `p1-patient`, `p2-ai-data`, `p3-shops-ops`. Commit after every working screen/route. If an AI agent fails 3 times on the same bug, run `git reset --hard HEAD` on your **own branch only**—never on `main`.