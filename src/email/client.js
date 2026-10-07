import dns from 'dns';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import logger from '../utils/logger.js';
import { config, PROVIDER_PRESETS } from '../config.js';

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

export class EmailClient {
  constructor(customConfig = {}) {
    const prov = (customConfig.provider || config.provider || 'gmail').toLowerCase();
    const preset = PROVIDER_PRESETS[prov] || PROVIDER_PRESETS.gmail;

    this.cfg = {
      provider: prov,
      user: customConfig.user || config.user,
      pass: customConfig.pass || config.pass,
      imapHost: customConfig.imapHost || preset.imapHost,
      imapPort: customConfig.imapPort || preset.imapPort,
      imapSecure: customConfig.imapSecure !== undefined ? customConfig.imapSecure : (preset.imapSecure ?? true),
      smtpHost: customConfig.smtpHost || preset.smtpHost,
      smtpPort: customConfig.smtpPort || preset.smtpPort,
      smtpSecure: customConfig.smtpSecure !== undefined ? customConfig.smtpSecure : (preset.smtpSecure ?? true),
      oauth2ClientId: customConfig.oauth2ClientId || config.oauth2ClientId,
      oauth2ClientSecret: customConfig.oauth2ClientSecret || config.oauth2ClientSecret,
      oauth2RefreshToken: customConfig.oauth2RefreshToken || config.oauth2RefreshToken,
      enableIdle: customConfig.enableIdle !== undefined ? customConfig.enableIdle : config.enableIdle,
    };

    this.id = customConfig.id || 'primary';
    this.authType = customConfig.authType || (this.cfg.oauth2RefreshToken ? 'oauth2' : 'password');
    this.onTokenRefresh = customConfig.onTokenRefresh || null;

    this.imap = null;
    this.smtp = null;
    this.connected = false;
    this.idleActive = false;
    this.statusListeners = [];
    this.onNewEmailCallback = null;
    this.lastSeenUid = 0;
    this._reconnecting = false;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
  }

  getSummary() {
    return {
      id: this.id,
      email: this.getMaskedUser(),
      provider: this.cfg.provider,
      authType: this.authType,
      connected: this.connected,
      idleActive: this.idleActive,
    };
  }

  isConfigured() {
    return Boolean(
      (this.cfg.user && this.cfg.pass) ||
      (this.cfg.user && this.cfg.oauth2RefreshToken)
    );
  }

  getMaskedUser() {
    return config.maskEmail(this.cfg.user);
  }

  getImapAuth() {
    if (this.cfg.oauth2RefreshToken && this.cfg.oauth2ClientId) {
      return {
        user: this.cfg.user,
        accessToken: null, // Will use refresh token
        refreshToken: this.cfg.oauth2RefreshToken,
        clientId: this.cfg.oauth2ClientId,
        clientSecret: this.cfg.oauth2ClientSecret,
      };
    }
    let pass = this.cfg.pass;
    if (this.cfg.provider === 'gmail' && pass && pass.includes(' ') && pass.replace(/\s+/g, '').length === 16) {
      pass = pass.replace(/\s+/g, '');
    }
    return {
      user: this.cfg.user,
      pass,
    };
  }

  async connect() {
    if (!this.isConfigured()) {
      logger.warn('Email credentials not configured. Running in stand-by mode.');
      return false;
    }

    try {
      // 1. Initialize IMAP Client
      this.imap = new ImapFlow({
        host: this.cfg.imapHost,
        port: this.cfg.imapPort,
        secure: this.cfg.imapSecure,
        auth: this.getImapAuth(),
        logger: {
          debug: (d) => logger.debug({ imap: d.msg || d }),
          info: (d) => logger.info({ imap: d.msg || d }),
          warn: (d) => logger.warn({ imap: d.msg || d }),
          error: (d) => logger.error({ imap: d.msg || d }),
        },
        clientInfo: {
          name: 'Syndae-Agent-OS',
          version: '1.0.0',
        },
      });

      this.imap.on('error', err => {
        logger.error({ id: this.id, err: err.message }, 'IMAP connection error');
        if (this.connected) {
          this.connected = false;
          this.idleActive = false;
          this.scheduleReconnect(3000);
        }
      });

      this.imap.on('close', () => {
        this.connected = false;
        this.idleActive = false;
        logger.info({ id: this.id }, 'IMAP connection closed');
        this.scheduleReconnect(3000);
      });

      await this.imap.connect();
      this.connected = true;
      logger.info({ host: this.cfg.imapHost, user: this.getMaskedUser() }, 'Connected to IMAP server');

      // 2. Initialize SMTP Transporter
      let smtpPass = this.cfg.pass;
      if (this.cfg.provider === 'gmail' && smtpPass && smtpPass.includes(' ') && smtpPass.replace(/\s+/g, '').length === 16) {
        smtpPass = smtpPass.replace(/\s+/g, '');
      }

      const smtpAuth = this.cfg.oauth2RefreshToken
        ? {
            type: 'OAuth2',
            user: this.cfg.user,
            clientId: this.cfg.oauth2ClientId,
            clientSecret: this.cfg.oauth2ClientSecret,
            refreshToken: this.cfg.oauth2RefreshToken,
          }
        : {
            user: this.cfg.user,
            pass: smtpPass,
          };

      this.smtp = nodemailer.createTransport({
        host: this.cfg.smtpHost,
        port: this.cfg.smtpPort,
        secure: this.cfg.smtpSecure,
        auth: smtpAuth,
      });

      return true;
    } catch (err) {
      this.connected = false;
      let msg = err.message || 'Unknown connection error';
      if (err.authenticationFailed || err.response?.includes('AUTHENTICATIONFAILED')) {
        msg = 'Invalid credentials. Please verify your email address and 16-character Google App Password.';
      } else if (msg.includes('Unexpected close') || err.code === 'ECONNRESET') {
        msg = 'Connection closed by server. If using Gmail, please make sure IMAP is enabled in your Gmail settings (Settings → Forwarding and POP/IMAP → Enable IMAP).';
      }
      logger.error({ err: err.message, diagnosed: msg }, 'Failed to connect to email server');
      const enhancedError = new Error(msg);
      enhancedError.original = err;
      throw enhancedError;
    }
  }

  scheduleReconnect(delayMs = 3000) {
    if (this._reconnecting || !this.isConfigured()) return;
    this._reconnecting = true;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._reconnectAttempts = (this._reconnectAttempts || 0) + 1;
    const actualDelay = Math.min(delayMs * Math.min(this._reconnectAttempts, 4), 30000);

    logger.info(
      { id: this.id, attempt: this._reconnectAttempts, delayMs: actualDelay },
      `Scheduling IMAP reconnect in ${actualDelay}ms...`
    );

    this._reconnectTimer = setTimeout(async () => {
      try {
        logger.info({ id: this.id, attempt: this._reconnectAttempts }, 'Attempting IMAP reconnection...');
        await this.connect();
        this._reconnectAttempts = 0;
        this._reconnecting = false;
        logger.info({ id: this.id }, 'IMAP reconnected successfully! Resuming push listener...');
        if (this.onNewEmailCallback) {
          await this.startIdleListener(this.onNewEmailCallback);
        }
      } catch (err) {
        logger.warn({ id: this.id, err: err.message }, 'IMAP reconnect attempt failed');
        this._reconnecting = false;
        this.scheduleReconnect(actualDelay);
      }
    }, actualDelay);
  }

  async disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnecting = false;
    try {
      if (this.imap) {
        this.imap.removeAllListeners('exists');
        await this.imap.logout();
      }
    } catch (e) {
      // Ignore logout errors
    } finally {
      this.connected = false;
      this.idleActive = false;
    }
  }

  async ensureConnected() {
    if (!this.connected || !this.imap || !this.imap.usable) {
      await this.connect();
    }
  }

  async listEmails({ folder = 'INBOX', limit = 20, unreadOnly = false, since = null } = {}) {
    await this.ensureConnected();

    const lock = await this.imap.getMailboxLock(folder);
    try {
      const searchCriteria = {};
      if (unreadOnly) searchCriteria.seen = false;
      if (since) searchCriteria.since = new Date(since);

      const messages = [];
      const query = Object.keys(searchCriteria).length > 0 ? searchCriteria : { all: true };

      // Query latest message sequence
      const searchResults = await this.imap.search(query, { uid: true });
      if (!searchResults || searchResults.length === 0) {
        return [];
      }

      // Slice the most recent N messages (highest UIDs)
      const targetUids = searchResults.slice(-limit).reverse();
      if (targetUids.length === 0) return [];

      const fetchGenerator = this.imap.fetch(targetUids, {
        envelope: true,
        flags: true,
        internalDate: true,
        bodyStructure: true,
      }, { uid: true });

      for await (const msg of fetchGenerator) {
        const fromAddr = msg.envelope?.from?.[0];
        const toAddrs = (msg.envelope?.to || []).map(t => t.address || `${t.mailbox}@${t.host}`);
        const hasAttachments = Boolean(
          msg.bodyStructure?.childNodes?.some(node => node.disposition === 'attachment')
        );

        messages.push({
          uid: msg.uid,
          account: this.id,
          messageId: msg.envelope?.messageId || `uid-${msg.uid}`,
          from: fromAddr ? { name: fromAddr.name, address: fromAddr.address || `${fromAddr.mailbox}@${fromAddr.host}` } : null,
          to: toAddrs,
          subject: msg.envelope?.subject || '(No Subject)',
          date: msg.envelope?.date ? msg.envelope.date.toISOString() : msg.internalDate?.toISOString(),
          unread: !msg.flags.has('\\Seen'),
          flagged: msg.flags.has('\\Flagged'),
          hasAttachments,
        });
      }

      return messages;
    } finally {
      lock.release();
    }
  }

  async readEmail({ uid, folder = 'INBOX', markAsRead = true } = {}) {
    await this.ensureConnected();

    const lock = await this.imap.getMailboxLock(folder);
    try {
      const { content } = await this.imap.download(uid, undefined, { uid: true });
      const parsed = await simpleParser(content);

      if (markAsRead) {
        try {
          await this.imap.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
        } catch (e) {
          logger.warn({ err: e.message, uid }, 'Failed to set Seen flag');
        }
      }

      return {
        uid,
        account: this.id,
        messageId: parsed.messageId || `uid-${uid}`,
        subject: parsed.subject || '(No Subject)',
        from: parsed.from?.value?.[0] ? { name: parsed.from.value[0].name, address: parsed.from.value[0].address } : null,
        to: (parsed.to?.value || []).map(t => ({ name: t.name, address: t.address })),
        cc: (parsed.cc?.value || []).map(t => ({ name: t.name, address: t.address })),
        date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
        text: parsed.text || '',
        html: parsed.html || null,
        attachments: (parsed.attachments || []).map(att => ({
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
        })),
        inReplyTo: parsed.inReplyTo || null,
        references: parsed.references || null,
      };
    } finally {
      lock.release();
    }
  }

  async searchEmails({ query, folder = 'INBOX', limit = 20 } = {}) {
    await this.ensureConnected();

    const lock = await this.imap.getMailboxLock(folder);
    try {
      // Match query across subject or body or from
      const searchCriteria = {
        or: [
          { subject: query },
          { body: query },
          { from: query },
        ]
      };

      const searchResults = await this.imap.search(searchCriteria, { uid: true });
      if (!searchResults || searchResults.length === 0) {
        return [];
      }

      const targetUids = searchResults.slice(-limit).reverse();
      const messages = [];

      const fetchGenerator = this.imap.fetch(targetUids, {
        envelope: true,
        flags: true,
        internalDate: true,
      }, { uid: true });

      for await (const msg of fetchGenerator) {
        const fromAddr = msg.envelope?.from?.[0];
        messages.push({
          uid: msg.uid,
          account: this.id,
          messageId: msg.envelope?.messageId || `uid-${msg.uid}`,
          from: fromAddr ? { name: fromAddr.name, address: fromAddr.address || `${fromAddr.mailbox}@${fromAddr.host}` } : null,
          subject: msg.envelope?.subject || '(No Subject)',
          date: msg.envelope?.date ? msg.envelope.date.toISOString() : msg.internalDate?.toISOString(),
          unread: !msg.flags.has('\\Seen'),
        });
      }

      return messages;
    } finally {
      lock.release();
    }
  }

  async sendEmail({ to, subject, text, html, cc, bcc, replyTo, inReplyTo, references } = {}) {
    if (!this.smtp) {
      await this.ensureConnected();
    }

    if (!this.smtp) {
      throw new Error('SMTP transporter is not initialized');
    }

    const mailOptions = {
      from: `"${this.cfg.user.split('@')[0]}" <${this.cfg.user}>`,
      to,
      subject,
      text,
      html: html || undefined,
      cc: cc || undefined,
      bcc: bcc || undefined,
      replyTo: replyTo || undefined,
      inReplyTo: inReplyTo || undefined,
      references: references || undefined,
    };

    const info = await this.smtp.sendMail(mailOptions);
    logger.info({ messageId: info.messageId, to }, 'Email dispatched via SMTP');

    return {
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      response: info.response,
    };
  }

  async archiveOrMarkEmail({ uid, action, folder = 'INBOX', targetFolder } = {}) {
    await this.ensureConnected();

    const lock = await this.imap.getMailboxLock(folder);
    try {
      switch (action) {
        case 'read':
          await this.imap.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          return { success: true, action: 'marked_as_read', uid };
        case 'unread':
          await this.imap.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
          return { success: true, action: 'marked_as_unread', uid };
        case 'flag':
          await this.imap.messageFlagsAdd(uid, ['\\Flagged'], { uid: true });
          return { success: true, action: 'flagged', uid };
        case 'unflag':
          await this.imap.messageFlagsRemove(uid, ['\\Flagged'], { uid: true });
          return { success: true, action: 'unflagged', uid };
        case 'move':
          if (!targetFolder) throw new Error('targetFolder parameter required for move action');
          await this.imap.messageMove(uid, targetFolder, { uid: true });
          return { success: true, action: `moved_to_${targetFolder}`, uid };
        case 'delete':
          await this.imap.messageDelete(uid, { uid: true });
          return { success: true, action: 'deleted', uid };
        default:
          throw new Error(`Unknown action: ${action}. Expected read, unread, flag, unflag, move, or delete.`);
      }
    } finally {
      lock.release();
    }
  }

  async startIdleListener(onNewEmail) {
    if (!this.cfg.enableIdle || !this.isConfigured()) return;
    this.onNewEmailCallback = onNewEmail;
    await this.ensureConnected();

    try {
      this.imap.removeAllListeners('exists');

      this.imap.on('exists', async data => {
        try {
          if (data.prevCount !== undefined && data.count <= data.prevCount) {
            return;
          }
          const batchCount = data.prevCount !== undefined ? Math.max(1, data.count - data.prevCount) : 1;
          logger.info(
            { id: this.id, newCount: data.count, prevCount: data.prevCount, batch: batchCount },
            'New email notification received via IMAP IDLE'
          );

          // Fetch recent incoming messages (up to batchCount, max 10)
          const limit = Math.min(batchCount, 10);
          const latest = await this.listEmails({ folder: 'INBOX', limit });
          latest.sort((a, b) => a.uid - b.uid);

          for (const item of latest) {
            if (this.lastSeenUid && item.uid <= this.lastSeenUid) {
              continue;
            }
            this.lastSeenUid = Math.max(this.lastSeenUid, item.uid);
            const emailDetails = await this.readEmail({ uid: item.uid, folder: 'INBOX', markAsRead: false });
            if (typeof onNewEmail === 'function') {
              onNewEmail(emailDetails);
            }
          }
        } catch (e) {
          logger.error({ id: this.id, err: e.message }, 'Error handling IMAP IDLE exists event');
        }
      });

      // Opening INBOX puts ImapFlow in SELECTED state, allowing its built-in auto-IDLE
      await this.imap.mailboxOpen('INBOX');
      this.idleActive = true;
      logger.info({ id: this.id }, 'IMAP IDLE push listener active on INBOX');

      // Sync recent unread emails received while offline / reconnected
      if (!this.lastSeenUid) {
        const initial = await this.listEmails({ folder: 'INBOX', limit: 1 }).catch(() => []);
        if (initial.length > 0) {
          this.lastSeenUid = initial[0].uid;
        }
      } else {
        const catchup = await this.listEmails({ folder: 'INBOX', limit: 10 }).catch(() => []);
        catchup.sort((a, b) => a.uid - b.uid);
        for (const item of catchup) {
          if (item.uid > this.lastSeenUid) {
            this.lastSeenUid = item.uid;
            logger.info({ id: this.id, uid: item.uid, subject: item.subject }, 'Relaying email received while disconnected');
            const emailDetails = await this.readEmail({ uid: item.uid, folder: 'INBOX', markAsRead: false });
            if (typeof onNewEmail === 'function') {
              onNewEmail(emailDetails);
            }
          }
        }
      }
    } catch (err) {
      this.idleActive = false;
      logger.warn({ id: this.id, err: err.message }, 'Failed to start IMAP IDLE listener');
      this.scheduleReconnect(5000);
    }
  }
}

export default EmailClient;
