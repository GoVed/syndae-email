import fs from 'fs';
import path from 'path';
import { EmailClient } from './client.js';
import { refreshAccessToken } from '../auth/oauth.js';
import logger from '../utils/logger.js';
import config from '../config.js';

export class AccountManager {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.resolve(config.rootDir, 'data/accounts.json');
    this.accounts = new Map(); // id -> EmailClient
    this.relay = null;
    this.onNewEmail = null;
    this._watchdogInterval = null;
  }

  /**
   * Initializes and loads all accounts from disk and environment configuration
   */
  async init() {
    this.loadAccountsFromDisk();

    // If an account is configured via environment variables, register it as default if not already present
    if (config.user && (config.pass || config.oauth2RefreshToken)) {
      const defaultId = 'primary';
      if (!this.accounts.has(defaultId) && !Array.from(this.accounts.values()).some(c => c.cfg.user === config.user)) {
        logger.info({ user: config.maskEmail(config.user) }, 'Loading primary account from environment configuration');
        const client = new EmailClient({
          id: defaultId,
          provider: config.provider,
          user: config.user,
          pass: config.pass,
          imapHost: config.imapHost,
          imapPort: config.imapPort,
          imapSecure: config.imapSecure,
          smtpHost: config.smtpHost,
          smtpPort: config.smtpPort,
          smtpSecure: config.smtpSecure,
          oauth2ClientId: config.oauth2ClientId,
          oauth2ClientSecret: config.oauth2ClientSecret,
          oauth2RefreshToken: config.oauth2RefreshToken,
          enableIdle: config.enableIdle,
          onTokenRefresh: this.handleTokenRefresh.bind(this),
        });
        this.accounts.set(defaultId, client);
      }
    }

    logger.info({ totalAccounts: this.accounts.size }, 'AccountManager initialized');
  }

  loadAccountsFromDisk() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const acc of list) {
            if (acc && acc.id && acc.user) {
              const client = new EmailClient({
                id: acc.id,
                provider: acc.provider || 'gmail',
                user: acc.user,
                pass: acc.pass,
                imapHost: acc.imapHost,
                imapPort: acc.imapPort,
                imapSecure: acc.imapSecure,
                smtpHost: acc.smtpHost,
                smtpPort: acc.smtpPort,
                smtpSecure: acc.smtpSecure,
                oauth2ClientId: acc.oauth2ClientId || acc.oauth?.clientId,
                oauth2ClientSecret: acc.oauth2ClientSecret || acc.oauth?.clientSecret,
                oauth2RefreshToken: acc.oauth2RefreshToken || acc.oauth?.refreshToken,
                enableIdle: acc.enableIdle !== false,
                onTokenRefresh: this.handleTokenRefresh.bind(this),
              });
              this.accounts.set(acc.id, client);
            }
          }
          logger.info({ loadedCount: this.accounts.size }, 'Loaded email accounts from disk storage');
        }
      }
    } catch (err) {
      logger.error({ err: err.message, path: this.storagePath }, 'Failed to load accounts from disk');
    }
  }

  saveAccountsToDisk() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const list = [];
      for (const [id, client] of this.accounts.entries()) {
        list.push({
          id,
          provider: client.cfg.provider,
          user: client.cfg.user,
          pass: client.cfg.pass,
          imapHost: client.cfg.imapHost,
          imapPort: client.cfg.imapPort,
          imapSecure: client.cfg.imapSecure,
          smtpHost: client.cfg.smtpHost,
          smtpPort: client.cfg.smtpPort,
          smtpSecure: client.cfg.smtpSecure,
          oauth2ClientId: client.cfg.oauth2ClientId,
          oauth2ClientSecret: client.cfg.oauth2ClientSecret,
          oauth2RefreshToken: client.cfg.oauth2RefreshToken,
          enableIdle: client.cfg.enableIdle,
        });
      }

      fs.writeFileSync(this.storagePath, JSON.stringify(list, null, 2), { mode: 0o600 });
      logger.debug({ count: list.length }, 'Persisted email accounts to disk storage');
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to save accounts to disk');
    }
  }

  async handleTokenRefresh(accountId, newTokens) {
    logger.info({ accountId }, 'Saving rotated OAuth2 tokens to disk');
    const client = this.accounts.get(accountId);
    if (client) {
      if (newTokens.refreshToken) client.cfg.oauth2RefreshToken = newTokens.refreshToken;
      this.saveAccountsToDisk();
    }
  }

  /**
   * Connects all registered accounts to their IMAP/SMTP servers
   */
  async connectAll() {
    const results = [];
    for (const [id, client] of this.accounts.entries()) {
      if (client.isConfigured()) {
        try {
          await client.connect();
          results.push({ id, status: 'connected' });
        } catch (err) {
          logger.warn({ id, err: err.message }, 'Failed to connect account');
          results.push({ id, status: 'error', error: err.message });
        }
      } else {
        results.push({ id, status: 'unconfigured' });
      }
    }
    return results;
  }

  /**
   * Starts IMAP IDLE push listeners across all active accounts
   */
  async startAllIdleListeners(onNewEmail) {
    this.onNewEmail = onNewEmail;
    for (const [id, client] of this.accounts.entries()) {
      if (client.connected && client.cfg.enableIdle) {
        try {
          await client.startIdleListener(email => {
            onNewEmail(email, id);
          });
        } catch (err) {
          logger.warn({ id, err: err.message }, 'Failed to start IDLE for account');
        }
      }
    }
    this.startWatchdog();
  }

  startWatchdog() {
    if (this._watchdogInterval) clearInterval(this._watchdogInterval);
    this._watchdogInterval = setInterval(async () => {
      for (const [id, client] of this.accounts.entries()) {
        if (client.isConfigured() && (!client.connected || !client.idleActive)) {
          logger.info({ id }, 'Watchdog detected inactive IMAP IDLE listener, triggering reconnect...');
          if (this.onNewEmail) client.onNewEmailCallback = email => this.onNewEmail(email, id);
          client.scheduleReconnect(1000);
        } else if (client.connected && client.imap && client.imap.usable) {
          try {
            await client.imap.noop();
          } catch (e) {
            logger.warn({ id, err: e.message }, 'IMAP keep-alive NOOP ping failed, scheduling reconnect...');
            client.connected = false;
            client.idleActive = false;
            client.scheduleReconnect(1000);
          }
        }
      }
    }, 45000);
  }

  stopWatchdog() {
    if (this._watchdogInterval) {
      clearInterval(this._watchdogInterval);
      this._watchdogInterval = null;
    }
  }

  /**
   * Adds or updates an email account profile
   */
  async addAccount(accountData) {
    const id = (accountData.id || accountData.accountName || accountData.user.split('@')[0]).trim().toLowerCase();

    // Check if account already exists
    const existing = this.accounts.get(id);
    if (existing) {
      await existing.disconnect();
    }

    const client = new EmailClient({
      id,
      provider: accountData.provider || 'gmail',
      user: accountData.user,
      pass: accountData.pass || '',
      imapHost: accountData.imapHost,
      imapPort: accountData.imapPort,
      imapSecure: accountData.imapSecure,
      smtpHost: accountData.smtpHost,
      smtpPort: accountData.smtpPort,
      smtpSecure: accountData.smtpSecure,
      oauth2ClientId: accountData.oauth2ClientId || accountData.oauth?.clientId,
      oauth2ClientSecret: accountData.oauth2ClientSecret || accountData.oauth?.clientSecret,
      oauth2RefreshToken: accountData.oauth2RefreshToken || accountData.oauth?.refreshToken,
      enableIdle: accountData.enableIdle !== false,
      onTokenRefresh: this.handleTokenRefresh.bind(this),
    });

    await client.connect();
    this.accounts.set(id, client);
    this.saveAccountsToDisk();

    // If relay is active, attach listener for this new account immediately
    if (this.relay) {
      client.startIdleListener(email => {
        this.relay.forwardEmailToSyndae(email, id);
      });
    }

    logger.info({ id, user: client.getMaskedUser() }, 'Successfully added and connected email account');
    return client.getSummary();
  }

  /**
   * Removes an account and cleans up connections
   */
  async removeAccount(id) {
    const client = this.accounts.get(id);
    if (!client) {
      throw new Error(`Account '${id}' not found`);
    }

    await client.disconnect();
    this.accounts.delete(id);
    this.saveAccountsToDisk();
    logger.info({ id }, 'Removed email account');
    return { success: true, removed: id };
  }

  /**
   * Resolves an account client by ID or returns the default/first available account
   */
  getAccount(id) {
    if (id && this.accounts.has(id)) {
      return this.accounts.get(id);
    }

    if (id) {
      throw new Error(`Account '${id}' not found. Available accounts: ${Array.from(this.accounts.keys()).join(', ') || 'none'}`);
    }

    // Default: return first account
    const first = this.accounts.values().next().value;
    if (!first) {
      throw new Error('No email accounts configured. Connect an account via Modern Auth (/auth/connect) or .env');
    }
    return first;
  }

  /**
   * Lists summary of all active accounts
   */
  listAccounts() {
    const list = [];
    for (const [id, client] of this.accounts.entries()) {
      list.push(client.getSummary());
    }
    return list;
  }

  /**
   * Lists emails from a specific account or aggregates from all accounts
   */
  async listEmails({ account, folder = 'INBOX', limit = 20, unreadOnly = false, since = null } = {}) {
    if (account) {
      const client = this.getAccount(account);
      return await client.listEmails({ folder, limit, unreadOnly, since });
    }

    // If multiple accounts and none specified, query all accounts and merge
    if (this.accounts.size === 0) {
      throw new Error('No email accounts configured');
    }

    const allMessages = [];
    for (const [id, client] of this.accounts.entries()) {
      if (client.connected) {
        try {
          const msgs = await client.listEmails({ folder, limit, unreadOnly, since });
          allMessages.push(...msgs);
        } catch (e) {
          logger.warn({ id, err: e.message }, 'Failed to list emails for account during aggregate fetch');
        }
      }
    }

    // Sort descending by date
    allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return allMessages.slice(0, limit);
  }

  async searchEmails({ account, query, folder = 'INBOX', limit = 20 } = {}) {
    if (account) {
      const client = this.getAccount(account);
      return await client.searchEmails({ query, folder, limit });
    }

    const allMessages = [];
    for (const [id, client] of this.accounts.entries()) {
      if (client.connected) {
        try {
          const msgs = await client.searchEmails({ query, folder, limit });
          allMessages.push(...msgs);
        } catch (e) {
          logger.warn({ id, err: e.message }, 'Failed to search emails for account');
        }
      }
    }

    allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return allMessages.slice(0, limit);
  }

  async readEmail({ account, uid, folder = 'INBOX', markAsRead = true, shortenLinks = true, includeFullLinks = false } = {}) {
    const client = this.getAccount(account);
    return await client.readEmail({ uid, folder, markAsRead, shortenLinks, includeFullLinks });
  }

  async getEmailLink({ account, uid, linkId = null } = {}) {
    const client = this.getAccount(account);
    return await client.getEmailLink({ uid, linkId });
  }

  async sendEmail({ account, to, subject, body, html, cc, bcc, replyTo, inReplyTo, references } = {}) {
    const client = this.getAccount(account);
    return await client.sendEmail({ to, subject, text: body, html, cc, bcc, replyTo, inReplyTo, references });
  }

  async archiveOrMarkEmail({ account, uid, action, folder = 'INBOX', targetFolder } = {}) {
    const client = this.getAccount(account);
    return await client.archiveOrMarkEmail({ uid, action, folder, targetFolder });
  }
}

export default AccountManager;
