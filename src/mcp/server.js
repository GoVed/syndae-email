import { TOOL_DEFINITIONS } from './definitions.js';
import { AccountManager } from '../email/manager.js';
import { EmailClient } from '../email/client.js';
import logger from '../utils/logger.js';
import config from '../config.js';

export const SERVER_INFO = {
  name: 'syndae-email-server',
  version: '1.0.0',
};

export class EmailMcpServer {
  constructor(managerOrClient = null) {
    if (managerOrClient && typeof managerOrClient.listAccounts === 'function') {
      this.manager = managerOrClient;
    } else if (managerOrClient) {
      // Adapt single EmailClient (or mock) to AccountManager interface
      const client = managerOrClient;
      this.manager = {
        listAccounts: () => [
          client.getSummary ? client.getSummary() : {
            id: client.id || 'primary',
            user: client.getMaskedUser ? client.getMaskedUser() : 'configured',
            provider: client.cfg?.provider || 'custom',
            connected: Boolean(client.connected),
            authType: client.authType || 'password',
            idleActive: Boolean(client.idleActive),
          }
        ],
        listFolders: (opts) => client.listFolders ? client.listFolders(opts) : [],
        listEmails: (opts) => client.listEmails(opts),
        readEmail: (opts) => client.readEmail(opts),
        getEmailLink: (opts) => client.getEmailLink(opts),
        searchEmails: (opts) => client.searchEmails(opts),
        sendEmail: (opts) => client.sendEmail({
          to: opts.to,
          subject: opts.subject,
          text: opts.body,
          html: opts.html,
          cc: opts.cc,
          bcc: opts.bcc,
          replyTo: opts.replyTo,
          inReplyTo: opts.inReplyTo,
        }),
        archiveOrMarkEmail: (opts) => client.archiveOrMarkEmail(opts),
      };
    } else {
      this.manager = new AccountManager();
    }
  }

  async handleJsonRpc(req) {
    if (!req || typeof req !== 'object') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: payload must be a JSON object' },
      };
    }

    const { jsonrpc, id, method, params } = req;
    if (jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code: -32600, message: 'Invalid Request: jsonrpc version must be "2.0"' },
      };
    }

    if (method?.startsWith('notifications/')) {
      logger.debug({ method }, 'Received MCP notification');
      return null;
    }

    switch (method) {
      case 'initialize': {
        logger.info({ clientVersion: params?.protocolVersion, client: params?.clientInfo }, 'MCP Client initializing');
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: TOOL_DEFINITIONS,
          },
        };
      }

      case 'tools/call': {
        const { name, arguments: args = {} } = params || {};
        try {
          const result = await this.executeTool(name, args);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                },
              ],
            },
          };
        } catch (err) {
          logger.error({ tool: name, err: err.message }, 'Tool execution failed');
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32000,
              message: `Error executing ${name}: ${err.message}`,
            },
          };
        }
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
      }
    }
  }

  async executeTool(name, args) {
    switch (name) {
      case 'list_accounts': {
        return await this.manager.listAccounts();
      }

      case 'list_folders': {
        return await this.manager.listFolders({
          account: args.account || null,
        });
      }

      case 'list_emails': {
        return await this.manager.listEmails({
          account: args.account || null,
          folder: args.folder || 'INBOX',
          limit: args.limit ? parseInt(args.limit, 10) : 20,
          unreadOnly: Boolean(args.unread_only),
          since: args.since || null,
        });
      }

      case 'read_email': {
        if (args.uid === undefined || args.uid === null) {
          throw new Error('Missing required argument: uid');
        }
        return await this.manager.readEmail({
          account: args.account || null,
          uid: parseInt(args.uid, 10),
          folder: args.folder || 'INBOX',
          markAsRead: args.mark_as_read !== false,
          shortenLinks: args.shorten_links !== false,
          includeFullLinks: Boolean(args.include_full_links),
        });
      }

      case 'get_email_link': {
        if (args.uid === undefined || args.uid === null) {
          throw new Error('Missing required argument: uid');
        }
        return await this.manager.getEmailLink({
          account: args.account || null,
          uid: parseInt(args.uid, 10),
          linkId: args.link_id ? String(args.link_id) : null,
        });
      }

      case 'search_emails': {
        if (!args.query) {
          throw new Error('Missing required argument: query');
        }
        return await this.manager.searchEmails({
          account: args.account || null,
          query: args.query,
          folder: args.folder || 'INBOX',
          limit: args.limit ? parseInt(args.limit, 10) : 20,
        });
      }

      case 'send_email': {
        if (!args.to || !args.subject || !args.body) {
          throw new Error('Missing required arguments: to, subject, body');
        }
        return await this.manager.sendEmail({
          account: args.account || null,
          to: args.to,
          subject: args.subject,
          body: args.body,
          html: args.html || null,
          cc: args.cc || null,
          bcc: args.bcc || null,
          replyTo: args.reply_to || null,
          inReplyTo: args.in_reply_to || null,
        });
      }

      case 'archive_or_mark_email': {
        if (args.uid === undefined || args.uid === null || !args.action) {
          throw new Error('Missing required arguments: uid, action');
        }
        return await this.manager.archiveOrMarkEmail({
          account: args.account || null,
          uid: parseInt(args.uid, 10),
          action: args.action,
          folder: args.folder || 'INBOX',
          targetFolder: args.target_folder || null,
        });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

export default EmailMcpServer;
