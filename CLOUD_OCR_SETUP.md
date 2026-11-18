# Scan to Safe — Cloud OCR setup

The web app uses a Vercel serverless endpoint backed by Google Cloud Vision. The browser sends a compressed product photo to the endpoint; Google credentials remain on the server.

## 1. Create the Google Cloud service account

1. Create or select a Google Cloud project.
2. Enable billing and enable **Cloud Vision API**.
3. Create a service account for Scan to Safe.
4. Grant it the **Cloud Vision API User** role.
5. Create a JSON key for that service account and download it. Treat this file as a password; never commit it to GitHub or put it in frontend code.

## 2. Deploy the backend to Vercel

1. Sign in to Vercel and choose **Add New → Project**.
2. Import `kasturisonai-netizen/scan-to-safe-app`.
3. Keep the project root as the repository root. Vercel detects `api/ocr.ts` as a serverless function.
4. Deploy the project.
5. In **Project → Settings → Environment Variables**, add:
   - `GOOGLE_CLOUD_CREDENTIALS_JSON`: the complete contents of the downloaded service-account JSON file, pasted as one value.
   - `GOOGLE_CLOUD_PROJECT_ID`: your Google Cloud project ID.
   - `APP_ORIGIN`: `https://kasturisonai-netizen.github.io`
6. Redeploy after adding the variables.
7. Your endpoint will be `https://YOUR-VERCEL-DOMAIN/api/ocr`.

## 3. Connect the GitHub Pages web app

In GitHub, open **Settings → Secrets and variables → Actions → Variables** for this repository. Add a repository variable:

- Name: `VITE_OCR_API_URL`
- Value: the complete Vercel endpoint URL, for example `https://YOUR-VERCEL-DOMAIN/api/ocr`

Then run the **Deploy Scan to Safe to GitHub Pages** workflow again (Actions → select workflow → Run workflow), or push a new commit. The variable is public endpoint configuration, not a credential.

## 4. Verify

Open the web app and scan a product photo. The result should identify its engine as Google Cloud Vision. If it reports that Cloud OCR is not connected, the GitHub Actions variable has not yet been set in the Pages build.

## Privacy and cost

- Product images are sent to Google Cloud Vision for text recognition.
- Do not store service-account JSON in the repository, browser, or a `VITE_*` variable.
- Google Cloud Vision is a paid cloud service after any applicable free usage; check current Google Cloud pricing and billing before production use.
- The API endpoint enforces image-size and origin checks, but CORS is not authentication or a complete abuse-prevention system. Before public launch, add server-side rate limiting/abuse controls and monitor billing.
