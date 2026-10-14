import logger from '../utils/logger.js';
import config from '../config.js';
import { shortenEmailLinks } from '../utils/urlShortener.js';

export class SyndaeEmailRelay {
  constructor(target, options = {}) {
    this.target = target;
    this.syndaeApiUrl = (options.syndaeApiUrl || config.syndaeApiUrl).replace(/\/$/, '');
    this.syndaeAccessKey = options.syndaeAccessKey !== undefined ? options.syndaeAccessKey : config.syndaeAccessKey;
    this.running = false;
    this.stats = {
      relayedCount: 0,
      failedCount: 0,
      lastRelayedAt: null,
      lastError: null,
    };
  }

  async start() {
    this.running = true;
    try {
      if (this.target && typeof this.target.startAllIdleListeners === 'function') {
        await this.target.startAllIdleListeners((email, accountId) => {
          this.forwardEmailToSyndae(email, accountId);
        });
        logger.info({ syndaeApiUrl: this.syndaeApiUrl }, 'Syndae Multi-Account Email Inbound Relay active');
      } else if (this.target && typeof this.target.startIdleListener === 'function') {
        if (!this.target.isConfigured()) {
          logger.info('Email client not configured, Syndae relay standing by.');
          return;
        }
        await this.target.startIdleListener(email => {
          this.forwardEmailToSyndae(email, this.target.id || 'primary');
        });
        logger.info({ syndaeApiUrl: this.syndaeApiUrl }, 'Syndae Email Inbound Relay active');
      } else {
        logger.info('Relay target has no IDLE listener capability; standing by.');
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to start Syndae Email Relay');
    }
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Syndae-Email-Relay/1.0.0',
    };
    if (this.syndaeAccessKey) {
      headers['Authorization'] = `Bearer ${this.syndaeAccessKey}`;
      headers['X-Syndae-Access-Key'] = this.syndaeAccessKey;
    }
    return headers;
  }

  async forwardEmailToSyndae(email, accountId = null) {
    if (!email) return;

    const senderEmail = email.from?.address || 'unknown@sender.com';
    const senderName = email.from?.name || senderEmail;
    const triggerUrl = `${this.syndaeApiUrl}/api/tools/trigger`;
    const acc = accountId || email.account || 'primary';
    const accountTag = acc ? `[${acc}] ` : '';

    const rawText = email.text || '';
    const uid = email.uid !== undefined && email.uid !== null ? email.uid : 0;
    const shortened = shortenEmailLinks(rawText, { account: acc, uid });
    const cleanText = shortened.text;

    const requestBody = {
      protocol: 'email',
      event_type: 'new_email',
      source_id: senderName ? `${accountTag}${senderName} <${senderEmail}>` : `${accountTag}${senderEmail}`,
      channel_id: senderEmail,
      mode: 'chat',
      payload: {
        account: acc,
        sender: senderEmail,
        sender_name: senderName,
        subject: email.subject || '(No Subject)',
        message: `Account: ${acc}\nSubject: ${email.subject || '(No Subject)'}\nFrom: ${senderName} <${senderEmail}>\nDate: ${email.date}\n\n${cleanText}`.trim(),
        text: cleanText,
        links_count: shortened.count,
        message_id: email.messageId,
        date: email.date,
        in_reply_to: email.inReplyTo || null,
        is_group: false,
        has_attachments: Boolean(email.attachments && email.attachments.length > 0),
        attachments: (email.attachments || []).map(a => a.filename || 'attachment'),
      }
    };

    try {
      logger.info(
        { triggerUrl, from: senderEmail, subject: email.subject },
        'Relaying inbound email to Syndae Agent OS'
      );

      const res = await fetch(triggerUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        this.stats.relayedCount++;
        this.stats.lastRelayedAt = new Date().toISOString();
        logger.info(
          { sender: senderEmail, ignored: data.ignored, policy: data.policy, sessionId: data.session_id },
          'Email dispatched to Syndae successfully'
        );
        return data;
      } else {
        this.stats.failedCount++;
        this.stats.lastError = data.error || `HTTP ${res.status}`;
        logger.warn(
          { status: res.status, err: data.error },
          'Syndae returned error on email trigger dispatch'
        );
        return null;
      }
    } catch (err) {
      this.stats.failedCount++;
      this.stats.lastError = err.message;
      logger.error({ err: err.message }, 'Failed to dispatch email trigger to Syndae');
      return null;
    }
  }
}

export default SyndaeEmailRelay;
