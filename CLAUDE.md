# Bimeyar: rules for changing this app safely

Bimeyar is the live case-file app of **RICH INSURANS** (car insurance, Bangkok). It holds real customer
data: policies, ID scans, vehicle documents, claim photos and payment receipts. Treat every change as a change
to a production system. Talk to the owner (Pejman) in Persian.

## How it works (do not change the architecture without asking)

- **Frontend**: static PWA on GitHub Pages: https://ghosmali22-prog.github.io/bimeyar/ (repo: ghosmali22-prog/bimeyar, branch `main`).
  Every push to `main` goes live for every user within about a minute. There is no staging site.
- **Backend**: Google Apps Script web app "Bimeyar backend", owned by ghosmali22@gmail.com, deployed as
  *Execute as: Me*, *Who has access: Anyone*. Source: `backend/Code.gs` + `backend/appsscript.json`.
  The live URL is `API_URL` in `js/config.js`.
- **Data**: all files are in the **"Bimeyar"** folder in the owner's Google Drive and are owned by the owner.
  Customer = a folder inside "Bimeyar" (details as JSON in the folder description; all fields except the name are optional,
  see `CFIELDS` in `backend/Code.gs`). `saveCustomer` MERGES into the existing JSON: never write code that replaces it.
  Sub-folders (v3) = 4 folders inside a customer folder, tagged `appProperties.bimeyar = 'sub'` + `slot` (`policy`, `docs`, `prev`, `pay`).
  They are found by `slot`, never by name. Names live in `SUBFOLDERS` (backend) and `FOLDERS` (`js/config.js`).
  File = a file inside a customer folder OR one of its sub-folders, tagged with `appProperties.bimeyar = 'item'` and with type, expiry, uploader (`by`) and date (`at`).
  Files from v2 sit directly in the customer folder (`folder: ''`, shown as "Other / ไม่ระบุ"). They must stay there unless the user moves one.
  Invoice = a PDF file in the `pay` sub-folder with `appProperties.kind = 'invoice'`, `invNo`, `status`; the invoice data is JSON in its description.
  Invoice numbers come from Script property `INV_SEQ` under `LockService` only.
  The root folder is tagged `appProperties.bimeyar = 'root'`. The company logo file is tagged `bimeyar = 'logo'`.
- **AI**: Gemini is called only from the backend (`aiExtract`). The key is Script property `GEMINI_API_KEY`: never in the repo,
  never in the frontend, never in logs. The model is `GEMINI_MODEL`. The AI never saves anything by itself: every value is shown
  to the user first (review screen / "old → new" list). Log AI usage without customer data (`aiLog`).
- **Login**: "Sign in with Google" (openid/email/profile only). The backend verifies the ID token on every
  request (audience = `CLIENT_ID`) and checks the access list.
- **Access list**: Script Properties key `ACL` = `{ "email": "admin" | "editor" | "viewer" }`. The script owner is always admin.

## Hard rules

1. **Never delete or rewrite customer data in a migration.** Never permanently delete anything. Deletes must
   only move items to the Drive trash (`trashed: true`), so they can be restored for 30 days.
2. **Keep the data format backwards compatible.** Do not rename or remove `appProperties` keys, folder-description
   fields, file types (`policy, car, id, claim, payment, other`) or action names. Only add new optional fields,
   and make the code work when they are missing on old items.
3. **Never put customer data, screenshots of real customers, tokens or exports in this repo.** The repo is public.
4. **Requests to Apps Script must stay "simple" CORS requests**: POST, `Content-Type: text/plain`, JSON body,
   no custom headers and **no `xhr.upload` listeners** (they force a CORS preflight, which Apps Script cannot
   answer, and uploads fail with "Could not reach the server").
5. **Do not change `CLIENT_ID`, the OAuth project, the Apps Script project or the deployment URL** unless the owner asks.
6. Keep security checks in the backend: token verification, role checks per action, `assertCustomer` / `assertFile` / `ownerOf`
   (only items inside the Bimeyar folder can be touched). Never trust an email sent by the client.
7. **Folder migration only creates.** `migrateFolders` / `ensureSubs` may create sub-folders or add a tag to an exact-name
   folder. They must never move, rename or delete files. Files move only through `moveFile`, after the user confirms one file.
8. **Money and dates**: invoice totals are calculated in integer satang in `invoiceTotals` (backend). `calcTotals` in
   `js/invoice.js` is an exact copy for the preview; `node tests/invoice-totals.test.mjs` must pass after any change to either.
   Dates are stored as ISO `YYYY-MM-DD` in CE; Buddhist years (2400+) are converted with `beToCe`.
9. The service worker caches only the app shell list in `sw.js`. Never cache API responses or customer files.

## How to make a change

1. `git pull` first (some fixes were made directly on GitHub).
2. Work on a branch, not on `main`. Test locally (`python3 -m http.server 8765`, origin is allowed in the OAuth client)
   and in "This device only" demo mode, in English, Thai and Persian (RTL), on desktop and phone sizes.
3. Before merging to `main`, tag the current `main` so there is a rollback point:
   `git tag -a vX.Y.Z-stable -m "before <change>" && git push --tags`.
4. Bump `APP_VERSION` in `js/config.js` and `CACHE` in `sw.js` when frontend files change.
5. **Backend changes** (`backend/*`): follow `backend/DEPLOY.md`. If `appsscript.json` scopes change, the owner must run
   `setup` once in the editor before deploying. Paste the new code in the Apps Script editor, then
   **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**.
   This keeps the same `/exec` URL. Never create a *new* deployment for an update (that makes a new URL).
   Old versions stay in Apps Script, so a bad backend change can be rolled back by selecting the previous version.
   Keep `backend/Code.gs` in the repo identical to what is deployed.
6. After deploying, test with the owner's account: sign in, list, add a customer, upload a photo and a PDF,
   open a file, then delete the test items.

## Rollback

- Frontend: `git revert <commit>` (or reset `main` to the last `*-stable` tag) and push.
- Backend: Apps Script → Deploy → Manage deployments → edit → choose the previous version → Deploy.
- Data: deleted items are in the Drive trash for 30 days.
