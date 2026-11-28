This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app) for **RxBridge**, a healthcare coordination platform connecting patients, pharmacies, and pharmacists.

## Getting Started

First, configure `.env.local` with the required environment variables (do not commit `.env.local`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only — never expose to client components)
- `VISION_LLM_API_KEY` (for live OCR in `/api/extract`)
- `VISION_LLM_BASE_URL` (optional)
- `VISION_LLM_MODEL` / `VISION_LLM_MODELS` (optional)

Then run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Pharmacist Side Workflow

The pharmacist portal lives under `/pharmacist/*`:

- `/pharmacist/login` — Pharmacist email/password sign-in
- `/pharmacist/register` — Pharmacy onboarding (starts in `pending` verification status)
- `/pharmacist/dashboard` — 7-section dashboard shell & 9 real-DB overview KPIs
- `/pharmacist/inventory` — Catalog-linked & manual/unlinked inventory CRUD, batch/expiry tracking, atomic stock adjustments & movement ledger
- `/pharmacist/demand` — Anonymized patient medicine demand feed (verified shops only)
- `/pharmacist/prescriptions` & `/pharmacist/prescriptions/[id]` — Licensed pharmacist clinical review queue, 300s signed-URL prescription viewer, NTI/Schedule H safety checks & audit notes
- `/pharmacist/reservations` — Reservation fulfilment state machine (`pending` -> `approved` / `partially_approved` -> `preparing` -> `ready_for_pickup` -> `fulfilled`) backed by atomic Postgres `FOR UPDATE` RPCs
- `/pharmacist/profile` & `/pharmacist/settings` — Pharmacy profile management & team role roster (`owner`, `licensed_pharmacist`, `staff`)

See [PHARMACIST_MODULE_HANDOFF.md](./PHARMACIST_MODULE_HANDOFF.md) for full architecture, schema, RLS, RPC, and API documentation.

## Running Tests & Verification

```bash
# Run all P2 clinical + pharmacist unit & integration tests
npx tsx --test tests/pharmacist-*.test.ts tests/p2-*.test.ts

# TypeScript typecheck
npx tsc --noEmit

# Lint
npm run lint

# Production build (Next.js 16)
npm run build
```
