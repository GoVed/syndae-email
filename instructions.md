# Universal Email MCP Tool (IMAP & SMTP with Modern Auth)

## Overview
The `email` tool enables Syndae agents to read, search, draft, and send emails across multiple email accounts simultaneously using Modern Auth (OAuth 2.0 PKCE / SASL XOAUTH2) and open standards (IMAP + SMTP over TLS).

## Key Features
1. **Multi-Account Mailbox Architecture**:
   - Register, manage, and monitor multiple distinct mailboxes concurrently (e.g. `work`, `personal`, `school`).
   - Query individual inboxes or seamlessly aggregate recent emails across all accounts.
   - Dispatch outgoing emails from specific mailboxes using the `account` parameter.
2. **Modern Auth (OAuth 2.0 PKCE & XOAUTH2)**:
   - Zero static passwords stored on disk.
   - Interactive 1-click browser authentication (`/auth/connect`) exchanging PKCE codes for secure OAuth 2.0 refresh tokens.
   - Automatic background token rotation ensures continuous operation without re-prompting.
3. **Concurrent Real-time IMAP IDLE Push**:
   - Maintains open sockets across all registered accounts.
   - Inbound emails immediately trigger Syndae (`POST /api/tools/trigger` with `protocol: "email"`), tagged with account mailbox metadata.
4. **Deterministic Human-in-the-Loop Send Gating**:
   - Outbound emails (`send_email`) and destructive modifications (`archive_or_mark_email`) require approval tickets in Syndae.
5. **Intelligent Promotional Link Shortening & Context Window Protection**:
   - Automatically compresses bloated marketing/tracking URLs (e.g. tracking tokens, UTM tags) into clean indexed link references (e.g. `[Link #1: promo.store.com/sale]`).
   - Reduces promotional email context window usage by >85%.
   - Keeps full destination links accessible on-demand via the `get_email_link` tool or direct HTTP redirect endpoint (`/links/:account/:uid/:link_id`).

---

## Modern Auth Setup (1-Click Connect)

### Google Gmail / Google Workspace (OAuth 2.0)
1. Open your browser and navigate to:
   ```
   http://localhost:8771/auth/connect?provider=gmail&account=personal
   ```
2. If OAuth App credentials are not yet set in environment, enter your Google OAuth `Client ID` and `Client Secret` (configured with authorized redirect URI `http://localhost:8771/auth/callback`).
3. Complete the Google Consent screen.
4. The micro-daemon automatically persists encrypted refresh tokens to `data/accounts.json` (`chmod 600`) and begins real-time push immediately.

### Microsoft Outlook / Office 365 (OAuth 2.0)
1. Navigate to:
   ```
   http://localhost:8771/auth/connect?provider=outlook&account=work
   ```
2. Authorize via Microsoft Online consent screen.
3. The mailbox is registered and active instantly.

---

## Static App Password Setup (Alternative)
For providers without OAuth 2.0 or for local setups, you can still configure static App Passwords:
```bash
EMAIL_PROVIDER=gmail # or outlook, icloud, custom
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=xxxx xxxx xxxx xxxx
```

---

## Available MCP Tools
- **`list_accounts`** (LOW / Autonomous): List all configured mailboxes, providers, and live connection status.
- **`list_emails`** (LOW / Autonomous): Fetch recent emails from a specific account or aggregated across all accounts.
- **`read_email`** (LOW / Autonomous): Read full email body and attachment summaries with compressed promotional links.
- **`get_email_link`** (LOW / Autonomous): Retrieve the full destination URL for a shortened promotional link on demand.
- **`search_emails`** (LOW / Autonomous): Full-text search across subject, body, and sender.
- **`send_email`** (HIGH / Require Approval): Dispatch outbound email via SMTP with thread headers.
- **`archive_or_mark_email`** (MEDIUM / Require Approval): Star, read/unread, move, or trash emails.
