# Bimeyar: car insurance case files on Google Drive

A web app for a car insurance agent to keep every customer's policies, vehicle documents, ID scans, claim photos and payment receipts in one place, stored in Google Drive. It installs on a phone and a laptop like a normal app (PWA). It is in **English** by default, with **Thai** and **Persian** available from the language switch in the top bar.

## What it does

- **Glass dashboard**: expiring policies, files per month, customer growth and storage used, with 3D tilt and spring animations.
- **Customer case files**: one folder per customer in Drive. Each folder shows the customer's files as cards with category tabs.
- **Fast saving**: drag and drop, paste, pick files, or take a photo with the phone camera. The **assistant** guesses each file's category and customer from its name, so most uploads are a single click on "Save".
- **Assistant search** (Ctrl/⌘ K): type a plain sentence such as "Morgan car registration", "policies expiring soon", "photos this week", "กรมธรรม์ สมชาย" or "بیمه‌نامه رضایی". It runs on the device; nothing is sent anywhere.
- **Renewals**: every policy with an expiry date, sorted by urgency, with one-tap calling.
- **Preview, rename, recategorise, share and download** any file. Deletes go to the Drive trash, where they can be restored for 30 days.
- **Private by design**: the app uses the `drive.file` scope, so it can only see files it created itself. It can't see anything else in the Drive.

There is also a **"This device only"** mode (browser storage) with sample data, for trying the app before Drive is set up.

## 1. Publish it (GitHub Pages)

Google sign-in requires an `https://` address, and the phone needs to be able to reach the app, so host it on GitHub Pages:

1. Push this folder to a GitHub repository.
2. Open the repository, then go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then **main** and **/ (root)**, and click **Save**.
3. After about a minute the app is live at `https://<your-user>.github.io/<repo>/`.

## 2. Connect Google Drive (one time, about 10 minutes)

1. Go to <https://console.cloud.google.com/> and create a project (e.g. "Bimeyar").
2. **APIs & Services → Library**: search for **Google Drive API** and click **Enable**.
3. **APIs & Services → OAuth consent screen**: choose **External**, fill in the app name and your email, and add the scope `.../auth/drive.file`. Under **Test users**, add the Google account(s) that will use the app.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorised JavaScript origins**: `https://<your-user>.github.io` (and `http://localhost:8765` for local testing)
   - No redirect URI is needed.
5. Copy the **Client ID** (it ends with `.apps.googleusercontent.com`).
6. Either paste it into `js/config.js` (`GOOGLE_CLIENT_ID = '...'`) and push, so every device gets it, **or** open the app and go to **Settings → Google Client ID**, then click **Connect to Google Drive**.

The app then creates a **Bimeyar** folder in that Google account's Drive, with one subfolder per customer.

> **Whose Drive?** Files go to whichever Google account signs in. To use your own Drive as the storage, sign in with your account on the client's devices (and add it as a test user in step 3).
>
> While the consent screen is in **Testing** mode, Google asks the user to sign in again about once a week. To stop that, click **Publish app** on the consent screen. Because `drive.file` is a non-sensitive scope, no Google review is needed.

## 3. Install on phone and laptop

- **iPhone (Safari)**: open the site, tap **Share**, then **Add to Home Screen**.
- **Android (Chrome)**: open the site, tap **⋮**, then **Install app**.
- **Laptop (Chrome / Edge)**: click the install icon in the address bar.

## Run locally

```bash
cd bimeyar
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
| `js/i18n.js` | English, Thai and Persian text |
| `js/assistant.js` | Category and customer guessing, plain-sentence search |
| `js/store-drive.js` | Google Drive storage (folders, resumable uploads, metadata in `appProperties`) |
| `js/store-local.js` | On-device storage (IndexedDB) |
| `js/demo.js` | Fictional sample data |
| `js/util.js` | Dates (Gregorian, Thai Buddhist and Jalali), icons, helpers |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app (PWA) |
