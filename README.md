# DitsWorker v5

Internal tool for automating the Roblox login step account processing workflow. Takes a batch of accounts (username, password, and up to 5 backup codes), logs them in one by one through a controlled browser session, resolves two-step verification when needed, and reports per-account status (success, failed, or needs manual attention) through a simple web dashboard.

> This is an internal operational tool, not a general-purpose product. See [Risk & Disclaimer](#risk--disclaimer) before deploying it against real accounts at scale.

## Features

- **Bulk input parser** — paste tab-separated rows (from Excel/Sheets) and auto-fill the account form: `username <TAB> password <TAB> code1 <TAB> code2 <TAB> code3 <TAB> code4 <TAB> code5`.
- **Sequential processing** — one browser instance per account, processed one at a time, with a randomized delay between accounts.
- **2-Step Verification handling** — automatically switches to "Backup Code" verification and tries each provided code in order until one works.
- **Identity challenge detection** — detects Roblox's image-based "Confirm Your Identity" challenge and skips the account (flagged for manual review) instead of attempting to solve it.
- **Post-login account info** — after a successful login, checks and reports:
  - 2SV methods currently enabled on the account (Authenticator, SMS, Email, Recovery Code)
  - Xbox account connection status
- **Live progress dashboard** — a lightweight frontend polls `/api/status` and shows per-account status, progress bar, and a retry button for failed/challenged accounts.
- **Retry failed accounts** — re-runs only the accounts that failed or hit a captcha/challenge, without re-entering data.

## Tech stack

- **Backend:** Node.js, Express
- **Automation:** Puppeteer (Chromium)
- **Frontend:** Static HTML/CSS/JS (no framework), polling-based status updates

## Project structure

```
DitsWorker_v5/
├── public/
│   ├── index.html      # Dashboard UI (bulk input, account forms, results)
│   └── style.css        # Styling
├── login-worker.js       # Puppeteer automation logic (login, 2SV, account info)
├── server.js             # Express server & API endpoints
├── package.json
└── .gitignore
```

## Installation

```bash
git clone https://github.com/ditsune/DitsWorker_v5.git
cd DitsWorker_v5
npm install
```

Requires Node.js 16+ and enough local resources to run Chromium instances (Puppeteer downloads its own bundled Chromium on `npm install`).

## Running

```bash
node server.js
```

Then open `http://localhost:3000` in a browser.

## Usage

1. **Bulk input (optional):** Click "Bulk Input (Copy-Paste)" to expand the panel, paste tab-separated account rows, then click **Parse & Isi Form**. This fills the account cards below automatically.
2. **Manual input (alternative):** Fill in username, password, and up to 5 backup codes per account card. Use **+ Tambah Akun** to add more account slots.
3. Click **▶ Mulai Proses** to start. Accounts are processed one at a time; progress and per-account status update live.
4. If any accounts fail or hit a verification challenge, use **🔄 Ulangi yang Gagal** to retry only those accounts.
5. Use **🔄 Reset & Input Baru** to clear results and start a new batch.

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/process-accounts` | Starts processing a batch. Body: `{ accounts: [{ username, password, backupCodes }] }`. Returns immediately; processing continues in the background. |
| `GET` | `/api/status` | Returns current processing state: `{ isProcessing, accounts, results, currentIndex, total }`. Polled by the frontend every 500ms. |
| `POST` | `/api/reset` | Clears the current processing state. |

## Result statuses

| Status | Meaning |
|---|---|
| `processing` | Account is currently being logged in. |
| `success` | Login completed; 2SV methods and Xbox connection status attached if available. |
| `skip` | Login hit an identity/image challenge that requires manual verification, or another non-fatal Roblox-side message. |
| `failed` | Login attempt errored out, timed out, or all provided backup codes were invalid. |

## Risk & Disclaimer

This tool automates real logins to real Roblox accounts using browser automation (Puppeteer). Automating login flows on a third-party platform like Roblox generally sits outside what their Terms of Service allow, regardless of how the automation is implemented, and carries a standing risk of accounts being flagged or restricted — separate from any coding bugs. This is **not** eliminated by any particular runtime flag or timing configuration.

Practical notes for whoever operates this:
- Treat this as an internal, risk-accepted operational tool — not something to distribute externally or scale up thoughtlessly.
- Identity/image challenges are intentionally **not** auto-solved; those accounts are flagged (`skip`) for manual handling.
- IP reputation, account history, and login velocity all factor into how Roblox's systems evaluate a session — this tool does not control or guarantee any of that.

## License

Internal use — not licensed for redistribution.
