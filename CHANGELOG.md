# Changelog

## v4.3.0 (2026-11-21)

- **Edit with AI** (admin and editor): in the file window ("Edit with AI", that file) and on the customer screen
  ("Re-check all files with AI", every photo and PDF of the customer; two at a time, progress bar, **Stop**; the AI's
  answers stay 10 minutes in the cache). The existing Gemini `aiExtract` reads the file again; the app works out the
  folder (1–4, 5.1–5.5), the vehicle (chassis no. → plate; "Add vehicle" for a new plate or a new month), the month and
  the name `{plate} - {customer's real name}({M}) - {folder name}.{ext}` (never the nickname, so misspellings like
  `โชควไล`, wrong spacing like `-โชค…` and nicknames like `k.june` are fixed), plus, for policies, the vehicle data.
- **Preview before anything changes**: before → after for name, vehicle, month, folder (changes highlighted) and the
  vehicle data; everything editable, rows can be unticked; already correct = "OK, no change"; low confidence or an AI
  error = "Please choose" (unchanged unless you choose). **Back** = nothing changes. **Save** in small batches.
- **Undo AI edit** in the file window (that file), on the customer screen (its newest AI edit) and in Settings (admin:
  the last 5 AI edits, each can be undone): puts back the exact previous state (names, folders, file types, vehicle
  data). Something changed again since then is left as it is. A vehicle made by the edit stays (empty); nothing is deleted.
- **Backend changed → Version 9**: new actions `aiEditApply`, `aiEditUndo` (editor), `aiEditList` (admin); Script
  property `AIEDIT_LOG` (last 5); file / vehicle tag `aib`; file description line `AI edit <batch>: old ⇒ new [from>to|type]`;
  vehicle JSON `_ai` (old values of the last 5 edits). The plate (folder name) is never changed by an AI edit.
  No new permission, no `setup`.
- Tests: `node tests/aiedit.test.mjs` (107, incl. the real names), 21 new browser checks.

## v4.2.0 (2026-11-21)

- **Settings → Restore original file names** (admin): lists every file inside the root whose name was changed by the
  rename or move tools ("Renamed: old ⇒ new" lines), with the name it had BEFORE the first change. Names given at
  upload are not listed; invoices never. Preview per customer: current name → old name (editable), tick boxes,
  Tick all / Untick all, and per row "Name only" (default) or "Name + previous folder" (the folder before the move tool,
  from the "Moved from:" line). **Back** changes nothing; nothing changes before **Apply**.
- Apply (batches of 15, progress bar) only renames, and moves back when chosen. If the previous folder no longer exists
  (or is not this customer's), only the name is restored, the file stays where it is and the report lists it; old
  folders are never re-created. A name already in the folder gets " (2)". Never deletes, never changes the content.
  History lines stay; "Restored: new ⇒ old" is added. **Undo restore** puts the last batch back.
- The description now always keeps the FIRST "Renamed:" line (plus the last 9), so the oldest name is never lost again.
- **Backend changed → Version 8**: new actions `restorePlan` (read only), `restoreNames`, `restoreUndo`; Script property
  `RESTORE_LAST`; file tags `rsb` / `rsf` / `rst`. No new permission, no `setup`.
- Tests: `node tests/restore.test.mjs` (30), 14 new browser checks.

## v4.1.0 (2026-11-21)

- **Move to new folders → "Detect vehicles automatically"** (per customer): builds the customer's vehicles from what is
  already there, so nothing has to be entered again:
  - plates and months in file names that follow the pattern (`70-5416 - …(11) - …`), the year from the file's date
    (a file saved in January named `(12)` = December of the year before),
  - the customer's details (plate, contract date, policy start) and vehicles that already exist,
  - policy PDFs without a plate in the name, read by the existing AI (plate, chassis no., contract / start date).
  One vehicle per plate; month = contract date → policy start → the `(month)` of a file name.
- Preview first: detected vehicles (plate, month, where it came from, number of files) and every file → plate → month →
  folder → name. Months editable, vehicles and rows can be unticked. Nothing is created or moved before **Apply**.
  Apply creates the ticked vehicles (with the chassis no. / dates the AI read), then moves the files with the same rules
  (correct names kept, never deleted, **Undo last move** for the whole batch; the vehicles made stay, nothing is deleted).
  A file with no plate anywhere (e.g. company certificate) stays "please choose" and is not moved.
- **Backend unchanged** (still Version 7): uses `getFile`, `aiExtract`, `saveVehicle`, `moveNew`.
- Tests: 12 new checks in `tests/vehicles.test.mjs` (4 plates in 2 months from file names only, a policy PDF without a
  plate in its name, year from the file date), 10 new browser checks.

## v4.0.0 (2026-11-21)

- **Many vehicles per customer** (1 to 100+): plate, province, brand/model, chassis no., engine no., year, body type,
  insurer, policy no., contract date, start, expiry, premium (all optional except the plate). Add / edit / remove
  (remove = Drive trash only). Each vehicle's data is JSON in the description of its plate folder, MERGED on save.
  Customers from before v4: their single plate/policy in the customer details is shown as vehicle #1 and becomes a
  real vehicle the first time a file is saved into it; the customer details are never changed or removed.
- **Drive folders per customer / month / vehicle**: `{customer}/07 July 2026/70-5416/` with `1. กรมธรรม์รถยนต์`,
  `2. กรมธรรม์ขนส่งสินค้า`, `3. พรบ.`, `4. ใบวางบิล/ใบเสนอราคา`, `5. เอกสารตัวรถยนต์` (5.1–5.5 inside). Month = contract
  date, else policy start, else the day the vehicle is added (Buddhist years → CE). Created when first needed, found by
  tags only (`bimeyar` = `month` / `vehicle` / `slot`). Files go only into 1–4 and 5.1–5.5. Invoices go into folder 4
  of their vehicle (name `RI-YYYY-NNNN.pdf` unchanged).
- **File names never use the nickname**: `{plate} - {customer name without บริษัท/จำกัด/…}({M}) - {folder name}.{ext}`,
  e.g. `70-5416 - โชควิไล ทรานสปอร์ต(7) - กรมธรรม์รถยนต์.pdf` (`พรบ` without its dot, `/` becomes `-`).
  Names that already follow the pattern are never changed (upload, rename tool, move tool).
- **Case file**: month cards → vehicle cards → the 5 folders → 5.1–5.5, with file counts; tabs per month and
  "Old folders" while v2/v3 files are still there. Same v2 design and classes.
- **Search** by name, nickname, plate, chassis no. or month; one result per vehicle ("customer · 70-5416 · July 2026").
  **Renewals**: one row per vehicle (latest month of each plate). The daily e-mail also lists vehicles.
- **Smart upload** (home screen, drop anywhere): one or many files without choosing a customer. The AI (same
  `aiExtract`, key and models; new `slot`, `insuredName`, `bodyType`) gives the folder; the app finds the customer by
  chassis no., then plate, then insured name / nickname, the vehicle (a policy of the same plate in a new month =
  renewal), and the month. Review list: file → customer → vehicle → month → folder → new name, with a confidence label,
  everything editable. New customer / new vehicle are only created when ticked. Photos without plate get the vehicle of
  the other files of the batch. AI failed or busy: choose by hand, the upload is never blocked. The normal upload in a
  case file uses the same list with the customer fixed.
- **Move to new folders** (Settings, admin): preview (file → from → plate / month / folder / name), editable rows, tick
  boxes, Apply per customer in batches of 10. Only moves: nothing deleted, copied or changed; the old folder is written
  in the description (`Moved from: …`) and tags `mvb` / `mvf` / `mvt` / `mvo`; **Undo last move**. Rows without a plate
  are not moved. **Empty old folders** lists the v3 folders that are empty (the owner deletes them in Drive).
- Backend (Version 7): new actions `saveVehicle`, `deleteVehicle`, `moveNew`, `moveUndo`, `oldFolders`; `list` returns
  `vehicles`; `upload` / `moveFile` / `createInvoice` accept a vehicle; `ownerOf` / `assertFile` check the whole chain
  (5.x → 5 → plate → month → customer → root). New customers no longer get the 4 v3 folders. No new permission
  (`appsscript.json` unchanged), no `setup` run. The v3.3 frontend keeps working with this backend.
- Tests: `node tests/vehicles.test.mjs` (133 checks incl. the security chain), headless-Chrome checks in demo mode.

## v3.3.0 (2026-11-21)

- **Device password**: sign in with Google once per device, then open the app with a password (at least 6 characters)
  or a 6-digit PIN. Right after "Sign in with Google" the app asks for it; **Skip** keeps the old behaviour
  (Settings → My devices → "Set a device password" sets it later).
- The backend gives the device its own session (`createDeviceSession`, only with a Google ID token): a random 256-bit
  secret that is shown once; Script property `DEVICE_SESSIONS` keeps only its SHA-256, email, device name, created,
  last used and expiry (30 days). Every request sends either the Google ID token or the session; the role is read from
  the ACL on every request, so a person removed from the ACL is blocked at once (and their sessions are deleted).
- On the device the secret is encrypted with PBKDF2-SHA-256 (250 000 rounds, random salt) + AES-CTR; only that blob is in
  localStorage. AES-CTR has no check value, so a wrong password cannot be tested on the device: the **server** counts
  wrong attempts and deletes the session after 5 (the device then deletes the blob and asks for Google). A copied blob
  cannot be guessed offline. The password is never stored or sent.
- Unlock screen (v2 design), **Forgot password** (Google again, new password, the old session is removed),
  auto-lock after 15 minutes without use (password, no Google), **Sign out** removes the blob and ends the session.
- Settings → **My devices**: device name, last used, expires, sign out any device. Admins also see every user's devices.
- At most 5 devices per person (a 6th replaces the one not used for the longest time).
- Backend changed (new actions `createDeviceSession`, `listMySessions`, `revokeSession`, `listAllSessions`, `revokeAny`;
  `doPost` accepts `dev: { sid, key }`). No new permissions, no `setup` run. Demo mode unchanged.

## v3.2.0 (2026-11-20)

- **Automatic file names on upload**: `{plate} - {customer}({month}) - {document}.{ext}`,
  e.g. `70-5416 - โชควิไล(11) - กรมธรรม์.pdf`. The plate is shown without the province; with several plates
  (customer's plate, plates in the customer's file names, the plate the AI read) a "Vehicle (plate)" choice appears.
  Customer = nickname if set, else the name without บริษัท / จำกัด / (มหาชน) / หจก. / ห้างหุ้นส่วนจำกัด / บจก.
  Month = contract date, else policy start, else upload month (no leading zero). Document name comes from the AI
  (`docName`), else from the folder (01 กรมธรรม์, 02 เอกสาร, 03 กรมธรรม์เดิม, 04 หลักฐานการชำระเงิน); the upload is never blocked.
  The name is shown before saving and can be edited. The backend removes `/ \ : * ? " < > |`, keeps the extension,
  adds ` (2)`, ` (3)`… for a name already in the folder (never overwrites) and keeps the original file name in the description.
- **Rename files** (Settings, admin): list old → new name, edit or untick rows, Apply. Only names change (no move,
  delete or content change); invoices keep their number. The old name is kept in the description; **Undo last rename**.
- **Nickname** (`nick`, "ชื่อเล่น / Nickname") and **contract date** (`contractDate`, วันทำสัญญาประกันภัย) customer fields (optional; the AI reads the contract date).
- **Copy share link** / **Stop sharing** in the file window: only that one file becomes "Anyone with the link: Viewer";
  a 🔗 icon marks shared files.
- Backend changed (new actions `shareFile`, `unshareFile`, `renameFiles`, `renameUndo`; `upload`, `updateFile`, AI schema updated). No new permissions.
