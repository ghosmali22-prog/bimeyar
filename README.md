# Bimeyar: RICH INSURANS car insurance case files

**Live app:** https://ghosmali22-prog.github.io/bimeyar/

A web app for **RICH INSURANS** to keep every customer's policies, vehicle documents, ID scans, claim photos and
payment receipts in one place. Every file is stored in the **owner's Google Drive**. People the owner approves sign
in with their own Gmail. The app installs on a phone and a laptop like a normal app (PWA), and works in
**English**, **Thai** and **Persian** (right-to-left).

> Changing the code? Read **[CLAUDE.md](CLAUDE.md)** first. This app stores real company data.

## What it does

- **Dashboard**: expiring policies, files per month, customer growth and Drive space used.
- **Customer case files**: one folder per customer, files shown as cards with category tabs.
- **Fast saving**: drag and drop, paste, pick files, or take a photo. The assistant guesses the category and customer from the file name. Photos are compressed before upload (25 MB limit).
- **Assistant search** (Ctrl/⌘ K) in plain sentences, in all three languages. It runs on the device.
- **Renewals**: policies sorted by how soon they expire, with one-tap calling.
- **Team & access** (admin only): add or remove people by Gmail, with roles admin, editor (view, upload, edit) or viewer (view only).
- Deletes go to the Drive trash and can be restored for 30 days. Each file records who uploaded it.
- **This device only** demo mode with sample data, for trying the app without signing in.

## How it works

```
Phone / laptop (GitHub Pages PWA)
   │  Sign in with Google → ID token (openid, email, profile only; no Drive access in the browser)
   ▼
Apps Script web app "Bimeyar backend" (runs as the owner)
   │  verifies the token, checks the access list, then reads and writes Drive
   ▼
Owner's Google Drive → "Bimeyar" folder → one folder per customer → files
```

| Part | Where |
|---|---|
| Frontend | this repo, branch `main`, served by GitHub Pages |
| Backend | `backend/Code.gs` + `backend/appsscript.json`, deployed in Apps Script project "Bimeyar backend" (owner ghosmali22@gmail.com); its `/exec` URL is `API_URL` in `js/config.js` |
| Login | Google Cloud project "Bimeyar", Web OAuth client (`GOOGLE_CLIENT_ID` in `js/config.js`); allowed origins `https://ghosmali22-prog.github.io` and `http://localhost:8765` |
| Data | "Bimeyar" folder in the owner's Google Drive (never in this repo) |
| Access list | Apps Script → Project settings → Script properties → `ACL` |

## Adding or removing people

Open the app with the owner account → **Settings** (top right) → **Team & access** → type the Gmail address,
choose a role and press **Add person**. The person can then sign in with that Gmail. Removing someone blocks them
on their next action. Their uploads stay in the owner's Drive.

## Updating the backend

Paste the new `backend/Code.gs` into the Apps Script editor, save, then
**Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. This keeps the same URL.
To roll back, choose the previous version there.

## Install on phone and laptop

- **iPhone (Safari)**: Share → **Add to Home Screen**.
- **Android (Chrome)**: ⋮ → **Install app**.
- **Laptop (Chrome / Edge)**: the install icon in the address bar.

## Run locally

```bash
python3 -m http.server 8765
# open http://localhost:8765
```

No build step and no dependencies: plain HTML, CSS and JavaScript modules.

## Project layout

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `css/app.css` | Glass design, animations, responsive layout |
| `js/app.js` | Views, upload flow, sheets, events |
| `js/auth.js` | Google sign-in (ID token only) |
| `js/store-remote.js` | Calls to the Apps Script backend |
| `js/store-local.js` | On-device demo storage (IndexedDB) |
| `js/i18n.js` | English, Thai and Persian text |
| `js/assistant.js` | Category and customer guessing, plain-sentence search |
| `js/demo.js` | Fictional sample data |
| `js/util.js` | Dates (Gregorian, Thai Buddhist and Jalali), icons, image compression |
| `js/config.js` | Client ID, backend URL, upload limit, version |
| `backend/` | Apps Script backend source |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app (PWA) |

## راهنمای فارسی

- **آدرس اپ:** https://ghosmali22-prog.github.io/bimeyar/
- **فایل‌ها کجا هستند؟** در پوشهٔ «Bimeyar» در Google Drive حساب ghosmali22@gmail.com. هیچ فایل مشتری روی GitHub نیست.
- **اضافه کردن یک نفر:** با حساب خودت وارد اپ شو ← تنظیمات (بالا سمت راست) ← «تیم و دسترسی» ← جیمیل را بنویس، نقش را انتخاب کن ← «افزودن نفر».
  - editor: دیدن، آپلود و ویرایش · viewer: فقط دیدن
- **حذف دسترسی:** همان صفحه ← «حذف دسترسی». فایل‌هایی که آن نفر آپلود کرده در Drive تو می‌مانند.
- **فایل پاک‌شده:** تا ۳۰ روز در سطل زبالهٔ Google Drive است و برمی‌گردد.
- **قبل از هر تغییری در کد:** به Claude Code بگو اول فایل CLAUDE.md را بخواند و `git pull` کند.
