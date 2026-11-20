# Changelog

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
