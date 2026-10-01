import logger from '../utils/logger.js';
import config from '../config.js';

export class StyxEmailRelay {
  constructor(target, options = {}) {
    this.target = target;
    this.styxApiUrl = (options.styxApiUrl || config.styxApiUrl).replace(/\/$/, '');
    this.styxAccessKey = options.styxAccessKey !== undefined ? options.styxAccessKey : config.styxAccessKey;
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
          this.forwardEmailToStyx(email, accountId);
        });
        logger.info({ styxApiUrl: this.styxApiUrl }, 'Styx Multi-Account Email Inbound Relay active');
      } else if (this.target && typeof this.target.startIdleListener === 'function') {
        if (!this.target.isConfigured()) {
          logger.info('Email client not configured, Styx relay standing by.');
          return;
        }
        await this.target.startIdleListener(email => {
          this.forwardEmailToStyx(email, this.target.id || 'primary');
        });
        logger.info({ styxApiUrl: this.styxApiUrl }, 'Styx Email Inbound Relay active');
      } else {
        logger.info('Relay target has no IDLE listener capability; standing by.');
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to start Styx Email Relay');
    }
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Styx-Email-Relay/1.0.0',
    };
    if (this.styxAccessKey) {
      headers['Authorization'] = `Bearer ${this.styxAccessKey}`;
      headers['X-Styx-Access-Key'] = this.styxAccessKey;
    }
    return headers;
  }

  async forwardEmailToStyx(email, accountId = null) {
    if (!email) return;

    const senderEmail = email.from?.address || 'unknown@sender.com';
    const senderName = email.from?.name || senderEmail;
    const triggerUrl = `${this.styxApiUrl}/api/tools/trigger`;
    const acc = accountId || email.account || 'primary';
    const accountTag = acc ? `[${acc}] ` : '';

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
        message: `Account: ${acc}\nSubject: ${email.subject || '(No Subject)'}\nFrom: ${senderName} <${senderEmail}>\nDate: ${email.date}\n\n${email.text || ''}`.trim(),
        text: email.text || '',
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
        'Relaying inbound email to Styx Agent OS'
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
          'Email dispatched to Styx successfully'
        );
        return data;
      } else {
        this.stats.failedCount++;
        this.stats.lastError = data.error || `HTTP ${res.status}`;
        logger.warn(
          { status: res.status, err: data.error },
          'Styx returned error on email trigger dispatch'
        );
        return null;
      }
    } catch (err) {
      this.stats.failedCount++;
      this.stats.lastError = err.message;
      logger.error({ err: err.message }, 'Failed to dispatch email trigger to Styx');
      return null;
    }
  }
}

export default StyxEmailRelay;
