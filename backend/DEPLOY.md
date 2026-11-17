# Deploying the v3 backend (step by step)

Do these steps in order. They keep the same `/exec` URL, so the app keeps working.
Nothing here moves or deletes any customer file.

## 1. Copy the code into Apps Script

1. Open https://script.google.com and open the project **"Bimeyar backend"** (signed in as ghosmali22@gmail.com).
2. **Show the manifest file** (needed once): ⚙️ **Project Settings** → tick **"Show 'appsscript.json' manifest file in editor"**.
3. Go back to **Editor** (`< >` icon).
4. Open **`appsscript.json`** → select everything → paste the full content of [`backend/appsscript.json`](appsscript.json) from this repo → **Save** (💾).
   This adds the permissions for Google Docs (invoice PDF), sending e-mail (expiry list) and triggers.
5. Open **`Code.gs`** → select everything → paste the full content of [`backend/Code.gs`](Code.gs) → **Save**.

## 2. Add the Gemini API key

1. Get a key: open https://aistudio.google.com/apikey (Google AI Studio, same Google account) → **Create API key**
   → copy it. Keys usually start with `AIza`.
2. Apps Script → ⚙️ **Project Settings** → scroll to **Script properties** → **Add script property**:
   - Property: `GEMINI_API_KEY`
   - Value: the key
3. **Save script properties**.

Never put the key in the repo, in `js/config.js`, in a chat or in an e-mail.

## 3. Give the new permissions (once)

1. In the editor, choose the function **`setup`** in the drop-down at the top → **Run**.
2. Google asks for permission → **Review permissions** → choose ghosmali22@gmail.com → **Advanced** →
   **Go to Bimeyar backend (unsafe)** → **Allow**. (It says "unsafe" only because it is your own private script.)
3. The log should show `Gemini key set: yes`.

## 4. Deploy a new version (same URL)

1. **Deploy** → **Manage deployments**.
2. Click the ✏️ (pencil) on the existing web app deployment.
3. **Version** → **New version** → description `v3.0.0` → **Deploy**.
4. Check that the Web app URL is still the same as `API_URL` in `js/config.js`.

Do **not** use "New deployment": that makes a new URL and the app would stop working.

**Roll back:** Deploy → Manage deployments → ✏️ → Version: choose the previous version → Deploy.

## 5. Create the 4 folders for existing customers

In the app (signed in as the owner): **Settings → Drive folders**:

1. Press **Check (no changes)**. Read the report: how many customers, how many folders will be created,
   how many existing files stay where they are.
2. If it looks right, press **Create missing folders** and confirm.

It only creates folders. Files saved before v3 stay where they are and show under "Other / ไม่ระบุ" on the
customer page; you can move a file into a folder by opening it → **Move to folder**.

You can also run `migrationDryRun` from the Apps Script editor: it prints the same report in the log and writes nothing.

## 6. Company details for invoices

In the app: **Settings → Company & invoice details** (admin only): company name (RICH INSURANS), logo, address,
phone, tax ID, bank details, footer note, and the invoice number prefix (`RI` → `RI-2026-0001`).

## 7. Optional: daily e-mail with policies expiring in 30 days

- Turn **on**: in the editor choose **`enableDailyDigest`** → Run. Every day at 08:00 (Bangkok) an e-mail goes to the
  script owner (ghosmali22@gmail.com) when there are policies expiring in the next 30 days.
- Turn **off**: run **`disableDailyDigest`**.

## AI usage log

Every AI call is logged without any customer data (time, duration, size, tokens, result) in the Script property
`AI_LOG` (last 200 calls) and in Apps Script → Executions.
