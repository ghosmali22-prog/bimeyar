# พ.ร.บ. section (v4.5.0): data model and API contract

A separate section for compulsory motor insurance (พ.ร.บ.) documents, apart from the customers.
Everything here is NEW and uses its own Drive tags, so no existing tool (list, rename, move, restore names,
Edit with AI, migrateFolders) ever sees or touches these items, and the พ.ร.บ. files that already sit in a
vehicle's folder "3. พรบ." are never moved, renamed or changed.

## Drive

```
RICH INSURANSE (root, bimeyar=root)
└── พ.ร.บ.                         folder, appProperties bimeyar=prbroot          (Script property PRB_ROOT_ID)
    └── {insured name, exact}      folder, bimeyar=prbins, ik=<hash of the name>  description = insured JSON
        ├── {file name}.pdf        file, bimeyar=prb, kind=prb                    description = row JSON
        └── PRB-2026-0001.pdf      file, bimeyar=prb, kind=prbinv                 description = invoice JSON
```

- The `พ.ร.บ.` folder is made only when the first file is uploaded or imported (never by `prbList`).
  An existing folder named exactly `พ.ร.บ.` directly in the root without a `bimeyar` tag is adopted (tag added).
- Insured folder: name = the insured name exactly as printed (only / \ : * ? " < > | and control characters
  removed, spaces squeezed). `ik` = first 32 hex chars of SHA-256 of that cleaned name (Drive appProperties are
  limited to 124 bytes, Thai is 3 bytes a character). Found by `ik` + parent = the พ.ร.บ. folder, never by name.
  Insured JSON (merged, never replaced): `{ name, taxId, address, by, at }`.
- Row file appProperties: `bimeyar=prb, kind=prb, prbNo, barcode, plate, end, by, at` and optional
  `link='1'` (shared), `src=<source file id>` (imported copy). Row JSON in the description (fields below).
- Invoice file appProperties: `bimeyar=prb, kind=prbinv, invNo, status, total, by, at`. Invoice JSON in the description.
- Numbers: Script property `PRB_SEQ` = `{ "2026": 3 }` (per CE year of the issue date), taken under the
  script lock; numbers already in Drive are skipped. `INV_SEQ` and the RI invoices are never touched.

## Row fields (`PRB_FIELDS`, all optional strings; max length)

```
prbNo 20, barcode 30, plate 40, province 60, brand 40, model 60, body 60, vin 40, engineNo 40,
vehicleCode 20, cc 20, seats 20, weight 20, companyCode 20, insurer 80, policyNo 80, receiptNo 40,
contractDate date, issueDate date, start date, end date, periodTime 20,
netPremium money, discount money, stamps money, vat money, total money,
brokerName 120, brokerLicense 60, note 500
```
`date` = ISO YYYY-MM-DD CE (Buddhist years converted, as `ceDate`); `money` = number with 2 decimals (satang).
`prbNo` and `barcode`: digits only.

Row as returned to the app:
`{ id, insuredId, name, mime, size, createdAt, by, shared, src, ...PRB_FIELDS }`

## Totals (identical in backend `prbTotals` and `js/prb.js` `prbTotals`, tested)

Per line, in integer satang: `net = netPremium`, `stamps`, `vat`, `total = total` if given, else
`net + stamps + vat`. Grand totals = sums of each column. Returns baht numbers
`{ lines: [{ net, stamps, vat, total }], net, stamps, vat, total }`. Missing values count as 0.

## Actions (POST, same auth/ACL as all actions)

| action | role | request | result |
|---|---|---|---|
| `prbList` | viewer | – | `{ root: id or '', insured: [{ id, name, taxId, address, createdAt }], rows: [row], invoices: [invoice] }` |
| `prbUpload` | editor | `{ insured: { name, taxId, address }, row: {...}, meta: { name, orig, mime }, data: base64 }` | `{ insured, row }` |
| `prbUpdate` | editor | `{ id, row: {...} }` (merge; file name never changes) | `row` |
| `prbGetFile` | viewer | `{ id }` | `{ mime, data }` |
| `prbShare` / `prbUnshare` | editor | `{ id }` | `{ row, link }` / `row` |
| `prbDelete` | editor | `{ id }` (Drive trash only) | `true` |
| `prbImportPlan` | admin | – (read only) | `[{ id, name, mime, size, customerId, customer, vehicleId, plate, ym, imported }]` |
| `prbImport` | admin | `{ items: [{ id, insured, row, name }] }` (max 20) | `{ done: [{ id, row }], skipped: [{ id, why }] }` |
| `prbInvoice` | editor | `{ insuredId, rowIds: [], issue, due, lang, notes, dateFmt }` | `invoice` |

- **Duplicates**: `prbUpload`, `prbUpdate` and `prbImport` refuse a row whose `prbNo` or `barcode` is already
  used by another (not trashed) `kind=prb` file: error `duplicate` (message names the existing file).
- **Security**: every id is checked: a row/invoice file must have `bimeyar=prb`, its parent must be a
  `prbins` folder whose parent is the พ.ร.บ. folder (not trashed). `prbGetFile`/`prbShare` never accept other
  files; the existing `getFile`/`shareFile`/`assertFile` never accept these files (`bimeyar` is not `item`).
- **Import**: `prbImportPlan` lists files (`bimeyar=item`) whose parent is a vehicle folder with `slot=3`
  (same chain check as `ownerOf`), and `imported` = the row id of an existing copy (`src`). `prbImport` makes a
  Drive **copy** into the insured folder (new name, row JSON, `src` tag). The source file is never changed.
- **Invoice**: rows must all be in that insured folder. Line values come from the saved rows (not from the
  request). PDF (new function `prbInvoicePdf`, Sarabun, company header from settings) is saved in the insured
  folder. Invoice JSON: `{ v: 1, no, insuredId, issue, due, lang, notes, cust: { name, taxId, address },
  lines: [{ rowId, prbNo, plate, model, net, stamps, vat, total }], t: { net, stamps, vat, total },
  status: 'unpaid', createdBy, createdAt }`. Returned invoice = that JSON + `{ id, fileName, createdTime }`.

## File names (app side, `js/prb.js`)

The existing `buildName` of `js/naming.js` (unchanged):
`buildName({ plate: plateOnly(row.plate, row.province), customer: { name: insuredName }, month, doc: 'พ.ร.บ.', ext })`
with `month` = month of `contractDate` (purchase month), else `issueDate`, else `start`, else this month.
e.g. `71-5262 - พี พี เอส ทรานสปอร์ต(11) - พ.ร.บ..pdf` (company words are removed by `customerPart`, as for
the main files; the insured FOLDER keeps the full name). The backend only cleans the name and adds " (2)"…
