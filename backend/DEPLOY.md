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

## v3.2 update (file names, rename tool, share link)

Only steps 1 (paste `Code.gs`; `appsscript.json` did not change) and 4 (✏️ → **New version**, description `v3.2.0`).
No new permission, no `setup` run, no Script property to add. After deploying:

1. Upload a test file: the name is `{plate} - {customer}({month}) - {document}.pdf`; the same file again gets ` (2)`.
2. Open a file → **Copy share link** → open the link in a private window: only that file is visible. → **Stop sharing**.
3. Settings → **Rename files** (admin): check the list first. **Undo last rename** puts the old names back.

Roll back: Deploy → Manage deployments → ✏️ → choose the previous version → Deploy.

## v3.3 update (device password)

Only steps 1 (paste `Code.gs`; `appsscript.json` did not change) and 4 (✏️ → **New version**, description `v3.3.0`).
No new permission, no `setup` run, no Script property to add (`DEVICE_SESSIONS` is created by itself on the first
device password). `ACL` and `ROOT_ID` are not touched. After deploying:

1. Sign in with Google → the app asks for a device password → set one → the app opens.
2. Close the app and open it again: only the password is asked.
3. Settings → **My devices**: this device is listed. On a second device, sign out the first one: the first one is
   sent to Google sign-in on its next action.

Roll back: Deploy → Manage deployments → ✏️ → choose the previous version → Deploy. (With the old backend, devices
with a password are sent to Google sign-in once; nothing else changes.)

## AI usage log

Every AI **attempt** is logged without any customer data (time, model, status such as `ok` / `http503` /
`timeout`, ms, size, tokens, try number) in the Script property `AI_LOG` (newest entries, trimmed to fit 9 KB)
and in Apps Script → Executions.

## When Google AI is busy (503 / 429)

`aiExtract` retries automatically (2 s, 5 s, … with jitter, up to 3 tries per model) and then falls back to the
next model in `AI_MODELS` (`gemini-3.1-flash-lite` → `gemini-3.8-flash` → `gemini-3.6-flash`). A slow failure
(over 20 s) switches model at once.

Time limits: a busy Google can take minutes for one request and Apps Script cannot stop a request half-way, so new
attempts only start in the first 45 s; the app waits 240 s and shows the elapsed time and "this can take up to
3 minutes". When nothing works the app shows "Google AI is busy right now" with **Try again** and
**Fill in by hand** (the chosen photos are kept).

Results are kept 10 minutes in the script cache (CacheService), keyed by a hash of the files. If the app gave up
waiting but Google answered later, **Try again** returns that result at once (`AI_LOG` status `cache`). If the first
request is still running, the second one waits for it (`joined`) instead of asking Google again.

To see which models answer right now: in the editor choose **`aiModelsCheck`** → Run. It sends one test sentence
(no customer data) to each model and prints the status and time in the log.
