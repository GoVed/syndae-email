# Universal Email MCP Tool (IMAP & SMTP)

## Overview
The `email` tool enables Styx agents to read, search, and send emails across any standard email provider (Gmail, Outlook, iCloud, Fastmail, ProtonMail Bridge, or self-hosted mail servers) using 100% open standards (IMAP over TLS + SMTP over TLS).

## Features
1. **Real-time IMAP IDLE Push**:
   - Maintains an open socket to your inbox using the standard IMAP `IDLE` command.
   - When a new email arrives, it is immediately parsed and forwarded to Styx (`POST /api/tools/trigger` with `protocol: "email"`).
   - Zero polling overhead and instant responsiveness.
2. **Deterministic Human-in-the-Loop Send Gating**:
   - `send_email` and `archive_or_mark_email` are categorized as `REQUIRE_APPROVAL` (Ask).
   - When Styx drafts an email, an approval ticket appears in the UI. Styx cannot send emails without operator authorization.
3. **Channel Trigger Rules & Spam Filtering**:
   - Senders appear in Styx **Tool Hub → Inbound Trigger Rules & Channels**.
   - You can set newsletters or automated receipts to `Muted` (0 GPU inference), VIP senders to `Always`, or general contacts to `Mentions Only`.

## Provider Setup

### 1. Gmail / Google Workspace (Recommended)
1. Go to your [Google Account Security Settings](https://myaccount.google.com/security).
2. Ensure **2-Step Verification** is turned on.
3. Search for **"App passwords"** and create a new password named `Styx`.
4. Copy the generated 16-character password into `.env`:
   ```bash
   EMAIL_PROVIDER=gmail
   EMAIL_USER=your_email@gmail.com
   EMAIL_PASS=xxxx xxxx xxxx xxxx
   ```

### 2. Microsoft Outlook / Office 365
```bash
EMAIL_PROVIDER=outlook
EMAIL_USER=your_email@outlook.com
EMAIL_PASS=your_app_password
```

### 3. Apple iCloud
1. Go to [appleid.apple.com](https://appleid.apple.com/) → Sign-In and Security → **App-Specific Passwords**.
2. Generate a password for `Styx`.
3. In `.env`:
   ```bash
   EMAIL_PROVIDER=icloud
   EMAIL_USER=your_username@icloud.com
   EMAIL_PASS=xxxx-xxxx-xxxx-xxxx
   ```

### 4. Custom / Self-Hosted IMAP & SMTP
```bash
EMAIL_PROVIDER=custom
IMAP_HOST=mail.yourdomain.com
IMAP_PORT=993
IMAP_SECURE=true
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=465
SMTP_SECURE=true
EMAIL_USER=user@yourdomain.com
EMAIL_PASS=your_password
```

## Security Best Practices
- **Never use your master account password**: Always use a scoped **App Password** or **App-Specific Token**.
- **Protect your `.env` file**:
  ```bash
  chmod 600 /home/ved/Projects/styx_tools/email/.env
  ```
- **In-Memory Injection**: Credentials can also be supplied dynamically at runtime or via environment variables in docker-compose.
