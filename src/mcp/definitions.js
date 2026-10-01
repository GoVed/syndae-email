export const TOOL_DEFINITIONS = [
  {
    name: 'list_accounts',
    description: 'List all configured email accounts, their providers, masked addresses, and real-time connection status.',
    risk_level: 'LOW',
    policy: 'AUTONOMOUS',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_emails',
    description: 'Fetch a list of recent emails from the mailbox with envelope headers, read status, and attachment flags.',
    risk_level: 'LOW',
    policy: 'AUTONOMOUS',
    inputSchema: {
      type: 'object',
      properties: {
        account: {
          type: 'string',
          description: 'Specific email account/mailbox ID to fetch from (omit to aggregate recent emails across all accounts)',
        },
        folder: {
          type: 'string',
          description: 'Mailbox folder to list from (default: INBOX)',
          default: 'INBOX',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of recent emails to return (default: 20, max: 100)',
          default: 20,
        },
        unread_only: {
          type: 'boolean',
          description: 'Filter only unread/unseen emails',
          default: false,
        },
        since: {
          type: 'string',
          description: 'Optional ISO date string to only list emails received after this date',
        },
      },
    },
  },
  {
    name: 'read_email',
    description: 'Retrieve full email details including complete text body, sender/recipient metadata, and attachment summaries by message UID.',
    risk_level: 'LOW',
    policy: 'AUTONOMOUS',
    inputSchema: {
      type: 'object',
      properties: {
        account: {
          type: 'string',
          description: 'Specific email account ID containing the message (defaults to primary/first account)',
        },
        uid: {
          type: 'number',
          description: 'The unique message UID to read',
        },
        folder: {
          type: 'string',
          description: 'Mailbox folder containing the email (default: INBOX)',
          default: 'INBOX',
        },
        mark_as_read: {
          type: 'boolean',
          description: 'Whether to mark the email as read upon viewing (default: true)',
          default: true,
        },
      },
      required: ['uid'],
    },
  },
  {
    name: 'search_emails',
    description: 'Search mailbox for emails matching a keyword across sender, subject, or message body.',
    risk_level: 'LOW',
    policy: 'AUTONOMOUS',
    inputSchema: {
      type: 'object',
      properties: {
        account: {
          type: 'string',
          description: 'Specific email account ID to search within (omit to search across all accounts)',
        },
        query: {
          type: 'string',
          description: 'Search query string to find in subject, body, or sender address',
        },
        folder: {
          type: 'string',
          description: 'Mailbox folder to search (default: INBOX)',
          default: 'INBOX',
        },
        limit: {
          type: 'number',
          description: 'Maximum search results to return (default: 20)',
          default: 20,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'send_email',
    description: 'Draft and dispatch an outbound email via SMTP. Sensitive action: generates a Human-in-the-Loop approval ticket in Styx.',
    risk_level: 'HIGH',
    policy: 'REQUIRE_APPROVAL',
    inputSchema: {
      type: 'object',
      properties: {
        account: {
          type: 'string',
          description: 'Email account ID to send from (defaults to primary/first account)',
        },
        to: {
          type: 'string',
          description: 'Recipient email address (or comma-separated addresses)',
        },
        subject: {
          type: 'string',
          description: 'Email subject line',
        },
        body: {
          type: 'string',
          description: 'Plain text email body content',
        },
        html: {
          type: 'string',
          description: 'Optional HTML formatted body content',
        },
        cc: {
          type: 'string',
          description: 'Optional comma-separated CC recipients',
        },
        bcc: {
          type: 'string',
          description: 'Optional comma-separated BCC recipients',
        },
        reply_to: {
          type: 'string',
          description: 'Optional Reply-To email address',
        },
        in_reply_to: {
          type: 'string',
          description: 'Optional Message-ID of the parent email being replied to (for threading)',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'archive_or_mark_email',
    description: 'Manage email status: mark read/unread, flag/star, move to folder (e.g. Archive or Trash), or delete.',
    risk_level: 'MEDIUM',
    policy: 'REQUIRE_APPROVAL',
    inputSchema: {
      type: 'object',
      properties: {
        account: {
          type: 'string',
          description: 'Email account ID containing the message (defaults to primary/first account)',
        },
        uid: {
          type: 'number',
          description: 'Message UID to update',
        },
        action: {
          type: 'string',
          enum: ['read', 'unread', 'flag', 'unflag', 'move', 'delete'],
          description: 'Action to perform on the email',
        },
        folder: {
          type: 'string',
          description: 'Source folder containing the email (default: INBOX)',
          default: 'INBOX',
        },
        target_folder: {
          type: 'string',
          description: 'Destination folder when action is "move" (e.g. Archive, Trash)',
        },
      },
      required: ['uid', 'action'],
    },
  },
];

export default TOOL_DEFINITIONS;
