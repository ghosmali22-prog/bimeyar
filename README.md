# Bimeyar: RICH INSURANS car insurance case files

**Live app:** https://ghosmali22-prog.github.io/bimeyar/

A phone-first web app for **RICH INSURANS**. It keeps every customer's policy, vehicle documents, ID scans,
previous policy and payment receipts in one place, makes invoices, and shows which policies expire soon.
Every file is stored in the **owner's Google Drive**. People the owner approves sign in with their own Gmail.
It installs on an iPhone like a normal app (PWA) and works in **English**, **Thai** and **Persian**.

> Changing the code? Read **[CLAUDE.md](CLAUDE.md)** first. This app stores real company data.
> Deploying the backend? Follow **[backend/DEPLOY.md](backend/DEPLOY.md)**.

## What it does (v4)

- **Customers**: cards with a status badge (Active / Expiring within 30 days / Expired / Not set), search by name,
  phone or plate, and filters. At the top: total customers, policies expiring this month, expired.
- **Customer page**: customer details, then month cards → vehicle (plate) cards → the 5 folders (5.1–5.5 inside 5)
  with file counts and thumbnails; add / edit / remove vehicles (1 to 100+ per customer); invoices of that customer.
- **Smart upload**: drop any files without choosing a customer; the AI finds customer (chassis no., plate, insured name),
  vehicle, month and folder; a review list shows everything (editable) before anything is saved.
- **Expiring**: one row per vehicle, sorted by the nearest expiry, grouped: expired / next 7 / next 30 / next 60 days.
- **Invoices**: create an invoice from a customer (everything is pre-filled), A4 PDF with Thai font, saved
  automatically in the customer's payment folder, share or download on the phone, mark as paid, re-generate.
- **AI (Gemini)**: take a photo of a policy and the app fills in the new customer for you. You check every field
  before anything is saved. On every upload the AI suggests the folder and shows "old value → new value" changes.
- **Team & access** (admin): add people by Gmail as admin, editor (view, upload, edit, AI) or viewer (view only).
- Deletes go to the Drive trash and can be restored for 30 days.
- **This device only** demo mode with sample data, for trying the app without signing in.

## Drive folders (v4)

```
RICH INSURANSE/                         ← the app's root folder in the owner's Drive (found by ROOT_ID, not by name)
  <customer name>/                      ← one folder per customer (details are saved in the folder's description)
    07 July 2026/                       ← month of the contract date ("MM MonthName YYYY", the number is for sorting)
      99-0016/                          ← one folder per vehicle (plate only); the vehicle's data is in its description
        1. กรมธรรม์รถยนต์/
        2. กรมธรรม์ขนส่งสินค้า/
        3. พรบ./
        4. ใบวางบิล/ใบเสนอราคา/           ← also the invoices the app makes (RI-YYYY-NNNN.pdf)
        5. เอกสารตัวรถยนต์/
          5.1 สำเนาทะเบียนรถ/  5.2 สำเนากรมธรรม์เดิม/  5.3 รูปรถ/  5.4 หลักฐานการโอนเงิน/  5.5 หนังสือแต่งตั้ง/หนังสือรับรองบริษัท/
    01_กรมธรรม์/ … 04_หลักฐานการชำระเงิน/   ← v3 folders and v2 loose files: still shown ("Old folders") until moved
```

Every folder is found by a hidden tag (appProperties), never by name. The month and plate folders (with the 5 folders
and 5.1–5.5) are created the first time they are needed. Next year's renewal of the same plate goes into that year's
month folder. File names: `{plate} - {customer}({month}) - {document}.{ext}`, e.g.
`99-0016 - สมมติชัย ทรานสปอร์ต(7) - กรมธรรม์รถยนต์.pdf` (the customer name without บริษัท / จำกัด / …, never the nickname).
Old files are moved with **Settings → Move to new folders** (admin): preview, per customer, only moves, with undo.

## How it works

```
iPhone / laptop (GitHub Pages PWA)
   │  Sign in with Google → ID token (no Drive access in the browser)
   ▼
Apps Script web app "Bimeyar backend" (runs as the owner)
   │  verifies the token, checks the access list, then reads and writes Drive,
   │  makes invoice PDFs (Google Docs → PDF) and calls Gemini
   ▼
Owner's Google Drive → "Bimeyar" folder          Gemini API (key only in Script Properties)
```

| Part | Where |
|---|---|
| Frontend | this repo, branch `main`, served by GitHub Pages |
| Backend | `backend/Code.gs` + `backend/appsscript.json`, Apps Script project "Bimeyar backend" (owner ghosmali22@gmail.com); its `/exec` URL is `API_URL` in `js/config.js` |
| Login | Google Cloud project "Bimeyar", Web OAuth client (`GOOGLE_CLIENT_ID` in `js/config.js`) |
| Data | "Bimeyar" folder in the owner's Google Drive (never in this repo) |
| Script Properties | `ACL` (access list), `GEMINI_API_KEY` (AI), `COMPANY` (invoice details), `INV_SEQ` (invoice numbers), `AI_LOG` (AI usage, no customer data) |

## The Gemini API key

The key is stored **only** in Apps Script → Project Settings → Script properties, as `GEMINI_API_KEY`.
It is never in this repo and never reaches the browser: the app sends the document to the backend, the backend
calls Gemini. Get a key at https://aistudio.google.com/apikey. The models are `AI_MODELS` in `backend/Code.gs` (tried in order when Google is busy).

## Data fields

Customer (all optional except the name; old customers simply show "not set"):
name, nameEn, phone, idNo, dob, address, brand, model, year, color, plate, province, vin, engineNo,
insurer, policyNo, policyType, coverage, premium, policyStart, policyExpiry, note (and the old `car` field).
Dates are saved as `YYYY-MM-DD` in the Common Era. Thai Buddhist years (e.g. 2569) are converted to 2026 when read.
The display format (2026 / 2569) is chosen in Settings.

Invoice: number (`RI-2026-0001`, made by the backend under a lock), issue/due date, customer, vehicle, policy,
line items, discount, VAT 7% (optional), paid, status. Saved as a PDF in `04_หลักฐานการชำระเงิน`, with the data
in the PDF file's description.

## Install on phone and laptop

- **iPhone (Safari)**: Share → **Add to Home Screen**.
- **Android (Chrome)**: ⋮ → **Install app**.
- **Laptop (Chrome / Edge)**: the install icon in the address bar.

## Run locally

```bash
python3 -m http.server 8765
# open http://localhost:8765
node tests/invoice-totals.test.mjs   # invoice maths + validation tests
```

No build step and no dependencies: plain HTML, CSS and JavaScript modules.

## Project layout

| File | Purpose |
|---|---|
| `index.html` | App shell (sidebar on desktop, tab bar on phone) |
| `css/app.css` | Mobile-first design, light/dark mode |
| `js/app.js` | Screens, sheets, upload, AI review, invoices, settings |
| `js/ai.js` | Prepares files for the AI, cleans the answer, folder suggestion, "old → new" changes |
| `js/validate.js` | Thai phone, Thai ID checksum, dates (BE → CE), amounts, duplicate check |
| `js/invoice.js` | Invoice maths (copy of the backend's) and the invoice layout |
| `js/store-remote.js` | Calls to the Apps Script backend |
| `js/store-local.js` | On-device demo storage (IndexedDB) |
| `js/i18n.js` | English, Thai and Persian text |
| `js/auth.js` | Google sign-in (ID token only) |
| `js/assistant.js` | Plain-sentence search (Ctrl/⌘ K) |
| `js/util.js` | Dates, icons, image compression |
| `js/config.js` | Client ID, backend URL, folder names, version |
| `backend/` | Apps Script backend source and `DEPLOY.md` |
| `tests/` | Node tests for the invoice maths and validation |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app. The service worker caches only the app shell, never customer data |

## راهنمای فارسی

- **آدرس اپ:** https://ghosmali22-prog.github.io/bimeyar/
- **فایل‌ها کجا هستند؟** در پوشهٔ «Bimeyar» در Google Drive حساب مالک. هر مشتری یک پوشه با ۴ زیرپوشه دارد. هیچ فایل مشتری روی GitHub نیست.
- **کلید Gemini:** فقط در Apps Script ← Project Settings ← Script properties با نام `GEMINI_API_KEY`.
- **به‌روزرسانی backend:** فایل [backend/DEPLOY.md](backend/DEPLOY.md) را قدم به قدم انجام بده.
- **قبل از هر تغییری در کد:** به Claude Code بگو اول فایل CLAUDE.md را بخواند و `git pull` کند.
