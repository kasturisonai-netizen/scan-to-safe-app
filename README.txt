SCAN TO SAFE — OCR UPDATE FILES

This is an incremental update for the existing GitHub repository.
It adds browser-based English OCR using Tesseract.js and a review screen for possible date fields.

Files to replace/add in the GitHub repository:
- Replace package.json
- Replace src/App.tsx
- Replace src/styles.css
- Replace src/features/scanner/Scanner.tsx
- Replace src/features/scanner/types.ts
- Add src/features/scanner/dateExtraction.ts

After uploading, GitHub Actions should build automatically. Do not manually run the workflow if a run has already started.

Important:
- The first OCR run downloads the OCR language data and needs an internet connection.
- OCR is English-only in this first pass.
- Dates are suggestions only. The app does not determine or guarantee the correct expiry date.
- This update does not yet save products to the inventory or create reminders.
- No barcode scanning is included.
