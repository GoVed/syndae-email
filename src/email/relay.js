import logger from '../utils/logger.js';
import config from '../config.js';

export class StyxEmailRelay {
  constructor(emailClient, options = {}) {
    this.emailClient = emailClient;
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
    if (!this.emailClient || !this.emailClient.isConfigured()) {
      logger.info('Email client not configured, Styx relay standing by.');
      return;
    }

    this.running = true;
    try {
      await this.emailClient.startIdleListener(email => {
        this.forwardEmailToStyx(email);
      });
      logger.info({ styxApiUrl: this.styxApiUrl }, 'Styx Email Inbound Relay active');
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

  async forwardEmailToStyx(email) {
    if (!email) return;

    const senderEmail = email.from?.address || 'unknown@sender.com';
    const senderName = email.from?.name || senderEmail;
    const triggerUrl = `${this.styxApiUrl}/api/tools/trigger`;

    const requestBody = {
      protocol: 'email',
      event_type: 'new_email',
      source_id: senderName ? `${senderName} <${senderEmail}>` : senderEmail,
      channel_id: senderEmail,
      mode: 'chat',
      payload: {
        sender: senderEmail,
        sender_name: senderName,
        subject: email.subject || '(No Subject)',
        message: `Subject: ${email.subject || '(No Subject)'}\nFrom: ${senderName} <${senderEmail}>\nDate: ${email.date}\n\n${email.text || ''}`.trim(),
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
