# Changelog

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
