# Syndae Universal Email MCP Micro-Daemon

Self-hosted, 100% private email micro-daemon for **Syndae AI Agent OS**, exposing standard JSON-RPC 2.0 MCP endpoints to read, search, and send emails via open IMAP & SMTP standards, with real-time push via IMAP IDLE.

## Features
- **Universal Provider Support**: Works seamlessly with Gmail, Microsoft Outlook / Office 365, Apple iCloud, Fastmail, Yahoo, and self-hosted mailboxes.
- **MCP 2024-11-05 Compliant**: Plugs into Syndae Agent OS via HTTP or STDIO.
- **Real-Time Push**: Employs IMAP `IDLE` (RFC 2177) to push incoming emails instantly to Syndae without polling overhead.
- **Human-in-the-Loop Safe**: Outbound email sending (`send_email`) is gated by Syndae's approval ticket system.
- **Channel Rules Compatible**: Inbound email senders automatically appear in Syndae Tool Hub for 1-click trigger policy configuration (`Always`, `Mentions Only`, `Muted`).
- **Container Ready**: Includes lightweight Dockerfile and docker-compose deployment.

## Installation & Setup

```bash
git clone git@github.com:syndae-org/syndae-email.git
cd syndae-email
npm install
npm test
```

## Configuration

Copy `.env.example` to `.env` and set your credentials:

```bash
cp .env.example .env
chmod 600 .env
```

Example for Gmail:
```bash
EMAIL_PROVIDER=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=xxxx xxxx xxxx xxxx  # Google App Password
```

## Running the Daemon

```bash
# Direct node execution
PORT=8771 npm start

# Or using Docker
docker-compose up -d
```

## MCP Tools Exposed

| Tool | Parameters | Risk Level | Policy | Description |
|---|---|---|---|---|
| `list_emails` | `folder`, `limit`, `unread_only`, `since` | LOW | AUTONOMOUS | List recent emails with envelope headers and status |
| `read_email` | `uid`, `folder`, `mark_as_read` | LOW | AUTONOMOUS | Retrieve full email body and attachment summaries |
| `search_emails` | `query`, `folder`, `limit` | LOW | AUTONOMOUS | Search mailbox across subject, body, and sender |
| `send_email` | `to`, `subject`, `body`, `cc`, `bcc`, `reply_to` | HIGH | REQUIRE_APPROVAL | Draft and dispatch an email via SMTP |
| `archive_or_mark_email` | `uid`, `action`, `folder`, `target_folder` | MEDIUM | REQUIRE_APPROVAL | Mark read/unread, flag, move, or delete |

## License
Apache License 2.0. See [LICENSE](LICENSE) for details.
