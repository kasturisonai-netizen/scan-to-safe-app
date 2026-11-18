# Scan to Safe

A mobile-first product safety inventory app. Scan packaging photos to extract printed manufacturing and expiry-related dates, review the OCR results, and save confirmed products to a private personal inventory.

## Project status
The **scan-to-safe-v2** branch is the clean rebuild track. The existing main branch has been left unchanged.

## Planned features
- Email sign-up, sign-in and sign-out
- Camera capture and gallery upload
- OCR of printed packaging text
- Detection of MFG/MFD, EXP, Use By and Best Before dates
- Review and correction of OCR suggestions before saving
- Separate Medicine and General Products inventories
- Persistent per-user database storage
- Edit, delete, search and expiry status indicators
- In-app expiry alerts
- Capacitor-ready Android packaging

## Stack
React, TypeScript, Vite, Supabase Auth/Postgres/Storage, Tesseract.js and Capacitor.

## Setup
1. Create a Supabase project.
2. Copy `.env.example` to `.env` and fill in the Supabase project URL and anon key.
3. Run `supabase/migrations/202611190001_initial_schema.sql` in the Supabase SQL editor.
4. Install dependencies with `npm install`.
5. Start the app with `npm run dev`.

Never put a Supabase service-role key in frontend environment variables.

## Product safety
OCR results are suggestions, not a safety certification. Users must verify printed dates before saving. Ambiguous date formats must be flagged rather than silently guessed.

See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the complete product requirements and acceptance tests.
