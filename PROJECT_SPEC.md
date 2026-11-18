# Scan to Safe — Product & Engineering Specification

## Product goal
A mobile-first web app that reads printed dates from packaging photos, lets the user verify the result, and saves products to a private inventory. The same codebase should be ready for Android packaging with Capacitor.

## Core flows
1. Sign up / sign in with email and password.
2. Choose **Medicine** or **General Products**.
3. Take a photo or select one from the gallery.
4. Run OCR on the image and detect candidate manufacturing, expiry, best-before and use-by dates.
5. Show the original image, extracted text and date candidates for user verification.
6. Save the verified item to the signed-in user's inventory.
7. View, search, edit and delete saved items.
8. Show expiry status: expired, expiring soon, or safe based on the verified expiry/use-by date.
9. Provide in-app alerts for items approaching expiry. Browser notifications are optional and require permission.

## Non-negotiable scanning requirements
- OCR must run on the uploaded image; do not replace scanning with a manual-only form.
- Support common printed formats such as DD/MM/YYYY, DD-MM-YYYY, MM/YYYY, YYYY-MM-DD and month-year labels.
- Preserve the raw OCR text and confidence where available.
- Never silently assume whether an ambiguous numeric date is DD/MM or MM/DD. Ask the user to verify.
- Identify labels (MFG, MFD, Manufactured, EXP, Expiry, Use By, Best Before) using nearby OCR text.
- Date extraction is assistive. The user confirms the date before saving; the app must not claim to certify product safety.
- If OCR fails, offer image retake/crop and manual correction as a fallback.

## Inventory fields
- category: medicine | general
- product_name (required)
- brand (optional)
- batch_number (optional)
- manufacture_date (optional)
- expiry_date (optional)
- use_by_date (optional)
- best_before_date (optional)
- notes (optional)
- image_path (optional)
- raw_ocr_text (optional)
- created_at / updated_at

## Privacy and security
- Email authentication through Supabase Auth.
- Every inventory row belongs to an authenticated user.
- Enable Row Level Security (RLS) and enforce owner-only SELECT/INSERT/UPDATE/DELETE.
- Store uploaded images in a private bucket; users may access only their own folder.
- Never put Supabase service-role keys in browser code.
- Validate dates and file types; limit upload size.

## Initial technical direction
- React + TypeScript + Vite
- Supabase Auth, Postgres and private Storage
- Tesseract.js browser OCR for the first working web implementation
- Capacitor for later Android packaging
- Barcode/QR scanning is a later enhancement, not a substitute for printed-date OCR.

## Delivery phases
1. Foundation: schema, authentication, RLS, storage and app shell.
2. Scanning: camera/gallery input, OCR, date extraction and review.
3. Inventory: category views, CRUD, search and expiry status.
4. Alerts: in-app expiry alerts and optional browser notifications.
5. QA and Android: device testing, Capacitor build and Play Store preparation.

## Acceptance tests
- A new user can register, sign in and sign out.
- User A cannot read or modify User B's inventory or images.
- A package photo containing labelled dates produces date candidates from OCR text.
- Ambiguous candidates are visibly marked for confirmation.
- A confirmed item remains in inventory after refresh and a new login.
- Medicine and general products appear in separate inventory sections.
- Editing or deleting an item persists to the database.
- Expiry status is calculated from the confirmed date, not an unverified OCR guess.
