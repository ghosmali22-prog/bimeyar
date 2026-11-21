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
- **Data**: all files are in the root folder (named **"RICH INSURANSE"** in Drive since v4, found only by `ROOT_ID`) in the owner's Google Drive and are owned by the owner.
  Customer = a folder inside "Bimeyar" (details as JSON in the folder description; all fields except the name are optional,
  see `CFIELDS` in `backend/Code.gs`). `saveCustomer` MERGES into the existing JSON: never write code that replaces it.
  Sub-folders (v3) = 4 folders inside a customer folder, tagged `appProperties.bimeyar = 'sub'` + `slot` (`policy`, `docs`, `prev`, `pay`).
  They are found by `slot`, never by name. Names live in `SUBFOLDERS` (backend) and `FOLDERS` (`js/config.js`).
  File = a file inside a customer folder OR one of its sub-folders, tagged with `appProperties.bimeyar = 'item'` and with type, expiry, uploader (`by`) and date (`at`).
  Files from v2 sit directly in the customer folder (`folder: ''`, shown as "Other / ไม่ระบุ"). They must stay there unless the user moves one.
  v3.2 file extras: `appProperties.link = '1'` while the file is shared "anyone with the link: viewer" (only via `shareFile`, never a folder);
  `appProperties.rnb` = batch id of the last rename-tool run (Script property `RENAME_LAST` = last batch, for "Undo last rename").
  v4.2 "Restore original file names" (admin): `restorePlan` (read only) / `restoreNames` / `restoreUndo`; the oldest name is the
  "old" of the FIRST `Renamed:` line (descJoin always keeps it), the previous folder comes from the `Moved from: name [id]` line and
  is used only if it still exists for the same customer (never re-created). Adds `Restored: new ⇒ old`, tags `rsb`/`rsf`/`rst`,
  Script property `RESTORE_LAST`. Names given at upload and invoices are never restored.
  v4.3 "Edit with AI" (editor; list = admin): `aiEditApply` / `aiEditUndo` / `aiEditList`. Only renames, moves within ITS OWN
  customer's vehicles and MERGES ticked vehicle data (never the plate); keeps the previous state (file line
  `AI edit <batch>: old ⇒ new [from>to|type]`, vehicle JSON `_ai`, tag `aib`, Script property `AIEDIT_LOG` = last 5) so the
  undo is exact. The preview is computed in the app (`aiEditSuggest` in `js/vehicles.js`); nothing changes before Save.
  The description may end with lines `Original file name: …` and `Renamed: old ⇒ new`: the app shows them apart from the note and
  `updateFile` keeps them (`descSplit` / `descJoin`). Never write them into an invoice description (that is JSON).
  File names are built in `js/naming.js` (`{plate} - {customer}({month}) - {document}.{ext}`); the backend only cleans the name and
  adds " (2)", " (3)"… (`uniqueName`): never overwrite, never delete. Customer fields `nick` and `contractDate` are optional (v3.2).
  **Vehicles (v4)**: customer folder → month folder (`bimeyar = 'month'`, `year`, `month` = '07'; name "07 July 2026",
  month of the contract date, else policy start, else the day added) → plate folder (`bimeyar = 'vehicle'`, `plate`, `year`,
  `month`; name = plate only) → folders `1`…`5` and `5.1`…`5.5` inside `5` (`bimeyar = 'slot'`, `slot`). Names in `VSLOTS`
  (backend) and `VSLOTS` (`js/vehicles.js`); found by tags only. Files go only into 1–4 and 5.1–5.5, never into 5.
  The vehicle's data (`VFIELDS`) is JSON in the plate folder's description and `saveVehicle` MERGES it (never replace).
  One record = one plate in one month; a renewal is a new record in the new month. A customer's old single plate/policy
  in the customer JSON is shown as "vehicle #1" (`L:<id>`, js only) and becomes a record when first used; the customer
  JSON is never changed for this. File names (v4): `{plate} - {customer name, never the nickname}({M}) - {folder name}`.
  `upload` / `moveFile` / `createInvoice` take `vehicleId` + `slot`; without them they work as in v3.
  Invoice = a PDF file in the `pay` sub-folder (v3) or folder `4` of a vehicle (v4) with `appProperties.kind = 'invoice'`, `invNo`, `status`; the invoice data is JSON in its description.
  Invoice numbers come from Script property `INV_SEQ` under `LockService` only.
  The root folder is tagged `appProperties.bimeyar = 'root'`. The company logo file is tagged `bimeyar = 'logo'`.
- **AI** (v4.4): Claude first, Gemini as automatic fallback, called only from the backend (`aiExtract`, used by every AI feature).
  Keys are Script properties `CLAUDE_API_KEY` and `GEMINI_API_KEY`: never in the repo, never in the frontend, never in logs.
  Claude model: `CLAUDE_MODEL` (`claude-haiku-5-5` only, owner's decision: no Sonnet); PDFs as `document` blocks, photos as
  `image` blocks; NO strict json_schema for Claude (a schema this big gives "compiled grammar is too large"): the shape
  is in `AI_PROMPT_CLAUDE`, the reply is parsed by `claudeParse` and normalized by `claudeNormalize` into the same
  structure as Gemini's (unparseable = Claude failure -> Gemini). Without `CLAUDE_API_KEY`, or when Claude fails, the Gemini `AI_MODELS` are used.
  Models are tried in order (`aiChain`), with retries on 429/5xx/529/timeouts inside a time budget; see `aiExtract`. The AI never saves anything by itself: every value is shown
  to the user first (review screen / "old → new" list). Log AI usage without customer data (`aiLog`).
- **Login**: "Sign in with Google" (openid/email/profile only). The backend verifies the ID token on every
  request (audience = `CLIENT_ID`) and checks the access list.
- **Device password (v3.3)**: after the first Google sign-in a device can get its own session (`createDeviceSession`,
  Google ID token only). Script property `DEVICE_SESSIONS` keeps only the SHA-256 of the secret (+ email, device name,
  created, last used, expires = 30 days, wrong attempts). Requests then send `dev: { sid, key }` instead of `token`;
  the role is still read from the ACL on every request, never cached. The device keeps only an AES-CTR blob
  (PBKDF2 250k) in localStorage (`by_dev`); there is no check value on purpose, so only the server can tell a wrong
  password and it deletes the session after 5. Never add a check value/hash to the blob and never cache sessions.
  Code: `js/device.js`, `sessionAuth` / `dsEdit` in `backend/Code.gs`. Test: `node tests/device-session.test.mjs`.
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
7. **Folder migration only creates.** `migrateFolders` / `ensureSubs` / `vehicleSlots` / `monthFolder` may create folders
   or add a tag to an exact-name folder. They must never move, rename or delete files. Files move only through `moveFile`,
   after the user confirms one file, or through the owner-approved one-time **move tool** (`moveNew`, admin only, v4):
   it only moves a file into a folder of ITS OWN customer's vehicle, writes the old folder in the description and
   `mvf`/`mvt`/`mvb` tags, gives a pattern name only to names that do not follow the pattern, never touches an invoice's
   name or description, and `moveUndo` can put the last batch back. Old empty folders are never deleted by the app.
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

## Current deployment

- **Backend**: Apps Script deployment **Version 10** ("v4.4.0 Claude AI (Haiku 5.5) + Gemini fallback"), live since
  2026-11-22 02:00, same `/exec` URL; `backend/Code.gs` on `main` (37f834d) is identical to it. `aiModelsCheck`:
  `claude-haiku-5-5 (Claude, effort low): ok in 2478 ms | parsed: docType other, slot unknown, 27 fields`.
  Roll back: Manage deployments → edit → choose **Version 9** (v4.3.0 backend, Gemini only; the v4.4 app works with it).
  Quicker, without a deployment: delete Script property `CLAUDE_API_KEY` (Gemini is used at once).
  Version 9 = v4.3.0 (Edit with AI; "Edit with AI" / "Undo AI edit" need Version 9+). Version 8 = v4.2.0 (restore original file names). Version 7 = v4.0.0 (vehicles, folders per month/plate, Smart upload, move tool). Version 6 = v3.3.0: roll back the
  frontend first; files already moved into the v4 folders stay in Drive but the v3 app does not show them.
  Version 5 = v3.2.0 (incl. the v3.1.2 AI fixes), Version 2 = v3.0.0, Version 1 = the v2 backend.
- **Frontend**: `main` = release tag `v4.4.0` (v4.3 + AI on Claude, Gemini as fallback; only AI texts changed).
  Rollback tag of `main` before it: `v4.3-pre-claude` (= `v4.3.0`). Before that: `v4.2.0-stable` (= `v4.2.0`), `v4.1.0-stable` (= `v4.1.0`), `v4.0.0-stable` (= `v4.0.0`), `v3.3.0-stable` (= `v3.3.0`), `v3.2-pre-device` (= `v3.2.0`),
  `v3.1-pre-naming` (= `v3.1.0`), `v3.0.1-stable` (v3.0 look).
  The v2 frontend is tag `v2.0.1-pre-upgrade`.
- Tests: `node tests/ai-provider.test.mjs` (v4.4 Claude + Gemini fallback), `node tests/aiedit.test.mjs` (v4.3 Edit with AI), `node tests/restore.test.mjs` (v4.2 restore names), `node tests/vehicles.test.mjs` (v4 vehicles, folders, security chain, move tool + undo), `node tests/device-session.test.mjs` (device password, v3.3), `node tests/naming.test.mjs` (naming + backend upload/rename/undo/share on a fake Drive) and `node tests/invoice-totals.test.mjs`.

## Design (owner's decision)

The app keeps the **original v2 design** (light glass look, top nav, stat cards, dark customer panel, purple case file)
on laptop and phone. Do not redesign it. New features go inside that layout and reuse the v2 classes
(`.card`, `.btn`, `.pill`, `.set-card`, `.tile`, …). The v2 part of `css/app.css` stays unchanged; new styles go in the
"v3 features" section at the end. Light theme only (no automatic dark mode). Phone: same design in one column,
44px touch targets, 16px inputs. Check English, Thai and Persian (RTL) at 1440px and 390px.

## Rollback

- Frontend: `git revert <commit>` (or reset `main` to the last `*-stable` tag) and push.
  Full rollback of v3: revert to tag `v2.0.1-pre-upgrade` (e.g. `git revert -m 1 <v3 merge commit>`) and push.
- Backend: Apps Script → Deploy → Manage deployments → edit → choose the previous version → Deploy.
  Full rollback of v3: choose **Version 1**. (The v3 backend also works with the v2 frontend, so roll back the frontend first.)
- Data: deleted items are in the Drive trash for 30 days.
