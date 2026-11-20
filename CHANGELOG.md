# Changelog

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
