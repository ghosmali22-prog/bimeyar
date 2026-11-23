# Changelog

## v4.5.4 (2026-11-23)

- **Name spelling suggestions (พ.ร.บ. review)**: a spelling with extra Thai tone marks (e.g. "พี่ พี่") is never offered
  when the batch majority has none; the "pick one spelling" buttons show the majority spelling first (`spellingChoices`,
  `stripMarks`, `markCount` in `js/prb.js`). A saved name with extra marks no longer beats the batch.
- **Trash (Drive trash only, in-app confirm)**: PRB invoices (button in the invoice sheet, existing `prbDelete`) and an
  insured with 0 records and 0 invoices (new action `prbDeleteInsured`, only `prbins` folders inside the พ.ร.บ. folder).
- **Admin: reset PRB invoice numbers** (new action `prbSeqReset`): only when no PRB invoice exists (not trashed);
  numbers of trashed invoices are still skipped, so no duplicates.
- Sign-in / unlock screens: no "Try the demo on this device" button (private company app); demo code kept.
- CLAUDE.md: current deployment (backend Version 15, frontend v4.5.3) and the history cleanup.

## v4.5.3 (2026-11-23)

- **Branch prefix of Viriyah policy numbers** (the 5-digit number under "VIB"): new AI field `branchCode`, and the prompt says
  the first group is that number. When it is still missing, the suggestion uses the batch consensus, else the branch number
  the AI read, else the known branch of the code part (`VIB_BRANCH`: 69100 -> 00283). Always a suggestion (one click).
- **cc / seats / weight** are split in code from the raw "C.C./No. of Seats/Weight" text (new AI field `cswText`);
  separately read values are not trusted ("0/0/21" -> 0 / 0 / 21). Raw text that is not a triple: no cc at all.
- **Name consensus by sub-part** (`consensusName`): names are also compared by their parts after "/", "(" and "โดย",
  across all rows of the batch and the insured names already saved; a misread or cut part (e.g. "หจก.เท") gets the
  spelling used elsewhere (allowed difference relative to the length, so different short names are never merged).
- Cache prefix `ai7_`. More synthetic cases in `tests/prb-accuracy.test.mjs`.

## v4.5.2 (2026-11-23)

พ.ร.บ. reading accuracy: code post-processing after the AI (`prbPost` in `js/prb.js`), not only prompt wording.
- **Policy number** (Viriyah, companyCode VIB or insurer วิริยะ): a near-miss of `กธ` (กซ, กษ, กช, กฐ, …) is corrected
  automatically and the cell is marked "auto-corrected (was: …)". A number without its first group, a 13-digit barcode
  in the policy field, or a number that does not end with the PRB number gets a one-click suggestion built from the batch
  consensus prefix (`AAAAA BBBBB/กธ/`) + this row's PRB number. Prompt: keep all groups.
- **Names in one batch**: a name that differs from the majority by 1–4 characters (or only in spacing, e.g. a space after
  บริษัท) is highlighted with a one-click "use the spelling of the other rows". Prompt: same spacing as printed.
- **cc**: integer only, from the "C.C./No. of Seats/Weight" triple; the vehicle code (e.g. 2.40D) is never kept as cc.
- **Province**: only from the plate cell (new AI field `plateText`, text after the number); never from the address.
  Cache prefix `ai6_`.
- Test `tests/prb-accuracy.test.mjs`: 8 synthetic cases with the real error patterns and the expected output.

## v4.5.1 (2026-11-23)

- **Fix: data of one พ.ร.บ. appearing on another** (e.g. a policy number of the previous truck). Root cause: the AI prompt
  contained real example numbers (policy no., PRB no., barcode, chassis, company name); documents of one customer look
  alike and differ in single digits, so the model copied the example. The prompt now has patterns only and says to read
  every number from THIS document. Each file was already read on its own (cache key = SHA-256 of that file's bytes);
  cache prefix `ai5_`. Test `tests/prb-batch.test.mjs`: 8 files in one batch, no field leaks, 8 distinct cache keys.
- **Checks per พ.ร.บ.** (`prbSanity`): errors block saving (no insured name, duplicate PRB no./barcode also within the
  batch, invalid date); red warnings: PRB no. ≠ last part of the policy no., ≠ receipt no. (Viriyah), barcode without the
  PRB no., VAT/total, plate/chassis that do not match another row, end not after start.
- **Many files: one review table** (one editable row per file, warnings per row, "All fields" with Previous/Next).
  "Save all" saves only rows without errors, one by one; a failing row never stops the others; the reasons are shown.
- **Field mapping**: "C.C./No. of Seats/Weight" `0/3/15` → cc 0, seats 3, weight 15; body type exactly as printed;
  insurer name in Thai as printed.
- **Insured name**: suggestions of existing names (spaces, company words, brackets and "/" ignored), and rows of one batch
  that look like the same insured get a "pick one spelling" choice, so one company never gets two folders.
- **Security (old code)**: file preview shows a "PDF" only as a PDF-typed blob (an HTML file renamed .pdf cannot run);
  `thumbs` checks the file before a cached thumbnail is returned; `unshareFile` reads all permission pages.
- Repo is public: test data is synthetic only (real numbers/names removed from prompt, tests and docs).

## v4.5.0 (2026-11-23)

- **New "พ.ร.บ." section** (compulsory motor insurance), separate from Customers (see `backend/PRB.md`).
  Drive: `RICH INSURANSE / พ.ร.บ. / {insured name, exact} / files + PRB invoices`, with its own tags
  (`prbroot`, `prbins`, `prb`), so no existing tool (list, rename, move, restore names, Edit with AI, migration)
  sees or changes these items. The "พ.ร.บ." folder is made at the first upload or import.
- One row per พ.ร.บ.: PRB no., barcode, plate, model, chassis, engine no., dates, net premium, stamps, VAT, total…
  (JSON in the file description). Rows sorted by PRB no.; status active / expiring / expired; open file;
  copy share link (one file only, as before). Duplicates (PRB no. or barcode) are refused.
- Upload with a review screen (AI fills, you check; VAT and duplicate warnings; nothing saved before Save).
  Smart upload sends documents detected as พ.ร.บ. to this review instead of the customer folder (can be turned off per file).
- File names with the existing `buildName`: `{plate} - {insured}({purchase month}) - พ.ร.บ.` (company words removed as
  for the main files; the insured folder keeps the full name).
- Separate PRB invoice: number `PRB-YYYY-NNNN` (Script property `PRB_SEQ`, under the lock; `INV_SEQ` and RI invoices
  unchanged), several rows of one insured, per-vehicle net / stamps / VAT / total and grand total (integer satang,
  `prbTotals` in backend and `js/prb.js`), PDF in the insured's folder.
- Import tool (admin): preview of the พ.ร.บ. files already in the vehicles' folder 3, then a COPY into the section after
  confirmation. Originals are never moved, renamed or changed.
- `assertCustomer` also refuses พ.ร.บ.-tagged folders (they are never customers).
- Tests: `node tests/prb.test.mjs` (backend, fake Drive), `node tests/prb-front.test.mjs`.

## v4.4.1 (2026-11-22)

- **One shared date helper** `js/dates.js` (parse / compare / format, Buddhist Era <-> CE). `validate.js`
  (`toIsoDate`, `beToCe`, `realDate`) and `util.js` (`daysLeft`, `fmtDay`) now use it; their names did not change.
  Thai shows DD/MM/YYYY with the Buddhist year by default (the Settings choice still wins).
- **Fix "Expired" on a file tile while the vehicle is Active**: Smart upload took the file's expiry from the raw AI
  value, not from the reviewed (corrected) value of the new vehicle record. Now the file gets the reviewed date, and a
  doubtful AI date (end not after start, or more than 3 years later: BE/CE mix-up) is flagged and not used for the file.
- **Policy class rule** when no class is printed: own damage covered -> ชั้น 1; only theft/fire -> ชั้น 2; neither ->
  ชั้น 3 (new AI fields `odCover`, `tfCover`); a printed class always wins.
- **Body type and vehicle value**: new optional vehicle field `carValue` (VFIELDS, backend + app); body type always read.
- **พ.ร.บ. (compulsory) documents**: new AI docType `prb` (title "ตารางกรมธรรม์ประกันภัยคุ้มครองผู้ประสบภัยจากรถ"), no class;
  two-line chassis cell = VIN + engine number (an engine number is never kept as VIN); plate as NN-NNNN; insured name
  only as printed after "ชื่อ :"; new optional fields (PRB no., barcode, receipt no., vehicle code, cc/seats/weight,
  tax ID, period time, issue date, net premium, discount, stamps, VAT, total, broker + licence). The review screen
  warns when (net + stamps) x 7% != VAT (±0.01) or net + stamps + VAT != total. A พ.ร.บ. never changes a customer's name.
- **Wrong customer name on พ.ร.บ.**: a document found by plate / chassis but naming someone else is no longer attached
  silently: the row gets low confidence and a warning "the name on the document is …".
- AI cache key prefix `ai4_` (new answer shape). `ai.slowHint` no longer mentions Google.
- Test: `node tests/dates.test.mjs`.

## v4.4.0 (2026-11-22)

- **AI now runs on Claude** (`claude-haiku-5-5`, constant `CLAUDE_MODEL` in `backend/Code.gs`) for every AI feature:
  "Add customer with AI", Smart upload (customer, vehicle / plate, month, folder, document type), auto-detect vehicles,
  file naming and "Edit with AI". They all use the one backend action `aiExtract`, so the app logic did not change.
  PDFs go to Claude as `document` blocks and photos as `image` blocks (base64): Claude reads the files directly.
  No strict json_schema for Claude (this schema is too big: "compiled grammar is too large"): the JSON shape (keys and
  descriptions from `AI_FIELDS`, allowed docType / slot values) is in the prompt, and the reply is parsed robustly
  (```json fences and text around it are ignored, the first `{…}` block is used) and normalized into exactly the
  structure the app already gets from Gemini (missing field = null / confidence 0, invalid docType / slot = other /
  unknown, confidence 0–1). A reply that cannot be parsed counts as a Claude failure, so Gemini is used.
- **Gemini stays as automatic fallback**: when Script property `CLAUDE_API_KEY` is missing, or Claude is busy
  (429 / 5xx / 529 / timeout, after the same retries), rejects the request (bad key, no credit, 400), refuses, or a
  photo type Claude cannot read (HEIC) is sent, the Gemini models in `AI_MODELS` are used as before.
- Same retries, time budget and 10-minute cache. `AI_LOG` entries now have `prov` (`claude` / `gemini`) next to `model`.
- `aiModelsCheck` (run in the Apps Script editor) also tests Claude with the same request, prompt and parsing as `aiExtract`; `setup` shows whether
  `CLAUDE_API_KEY` is set.
- App texts no longer say "Google AI"; the Settings card says "Claude, Gemini as backup". No design change.
- **Backend changed → Version 10**. New Script property `CLAUDE_API_KEY` (set by the owner). No new permission, no `setup`.
  The v4.3 app works with this backend; without `CLAUDE_API_KEY` this backend works exactly like Version 9.
- Rollback tag of `main` before this change: `v4.3-pre-claude` (= `v4.3.0`).
- Test: `node tests/ai-provider.test.mjs`.

## v4.3.0 (2026-11-21)

- **Edit with AI** (admin and editor): in the file window ("Edit with AI", that file) and on the customer screen
  ("Re-check all files with AI", every photo and PDF of the customer; two at a time, progress bar, **Stop**; the AI's
  answers stay 10 minutes in the cache). The existing Gemini `aiExtract` reads the file again; the app works out the
  folder (1–4, 5.1–5.5), the vehicle (chassis no. → plate; "Add vehicle" for a new plate or a new month), the month and
  the name `{plate} - {customer's real name}({M}) - {folder name}.{ext}` (never the nickname, so misspellings like
  `สมมตชัย`, wrong spacing like `-สมมติ…` and nicknames like `k.bbb` are fixed), plus, for policies, the vehicle data.
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
  - plates and months in file names that follow the pattern (`99-0016 - …(11) - …`), the year from the file's date
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
- **Drive folders per customer / month / vehicle**: `{customer}/07 July 2026/99-0016/` with `1. กรมธรรม์รถยนต์`,
  `2. กรมธรรม์ขนส่งสินค้า`, `3. พรบ.`, `4. ใบวางบิล/ใบเสนอราคา`, `5. เอกสารตัวรถยนต์` (5.1–5.5 inside). Month = contract
  date, else policy start, else the day the vehicle is added (Buddhist years → CE). Created when first needed, found by
  tags only (`bimeyar` = `month` / `vehicle` / `slot`). Files go only into 1–4 and 5.1–5.5. Invoices go into folder 4
  of their vehicle (name `RI-YYYY-NNNN.pdf` unchanged).
- **File names never use the nickname**: `{plate} - {customer name without บริษัท/จำกัด/…}({M}) - {folder name}.{ext}`,
  e.g. `99-0016 - สมมติชัย ทรานสปอร์ต(7) - กรมธรรม์รถยนต์.pdf` (`พรบ` without its dot, `/` becomes `-`).
  Names that already follow the pattern are never changed (upload, rename tool, move tool).
- **Case file**: month cards → vehicle cards → the 5 folders → 5.1–5.5, with file counts; tabs per month and
  "Old folders" while v2/v3 files are still there. Same v2 design and classes.
- **Search** by name, nickname, plate, chassis no. or month; one result per vehicle ("customer · 99-0016 · July 2026").
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
  e.g. `99-0016 - สมมติชัย(11) - กรมธรรม์.pdf`. The plate is shown without the province; with several plates
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
