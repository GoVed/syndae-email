import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

export const PROVIDER_PRESETS = {
  gmail: {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  outlook: {
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  icloud: {
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  yahoo: {
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  fastmail: {
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.fastmail.com',
    smtpPort: 465,
    smtpSecure: true,
  },
};

export const config = {
  provider: (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase(),
  user: process.env.EMAIL_USER || '',
  pass: process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD || '',
  
  // IMAP Configuration
  get imapHost() {
    if (process.env.IMAP_HOST && process.env.IMAP_HOST.trim()) return process.env.IMAP_HOST.trim();
    return PROVIDER_PRESETS[this.provider]?.imapHost || 'imap.gmail.com';
  },
  get imapPort() {
    if (process.env.IMAP_PORT && process.env.IMAP_PORT.trim()) return parseInt(process.env.IMAP_PORT.trim(), 10);
    return PROVIDER_PRESETS[this.provider]?.imapPort || 993;
  },
  get imapSecure() {
    if (process.env.IMAP_SECURE && process.env.IMAP_SECURE.trim()) return process.env.IMAP_SECURE.trim() === 'true';
    return PROVIDER_PRESETS[this.provider]?.imapSecure ?? true;
  },

  // SMTP Configuration
  get smtpHost() {
    if (process.env.SMTP_HOST && process.env.SMTP_HOST.trim()) return process.env.SMTP_HOST.trim();
    return PROVIDER_PRESETS[this.provider]?.smtpHost || 'smtp.gmail.com';
  },
  get smtpPort() {
    if (process.env.SMTP_PORT && process.env.SMTP_PORT.trim()) return parseInt(process.env.SMTP_PORT.trim(), 10);
    return PROVIDER_PRESETS[this.provider]?.smtpPort || 465;
  },
  get smtpSecure() {
    if (process.env.SMTP_SECURE && process.env.SMTP_SECURE.trim()) return process.env.SMTP_SECURE.trim() === 'true';
    return PROVIDER_PRESETS[this.provider]?.smtpSecure ?? true;
  },

  // XOAUTH2 Options (if using OAuth2 refresh tokens)
  oauth2ClientId: process.env.OAUTH2_CLIENT_ID || null,
  oauth2ClientSecret: process.env.OAUTH2_CLIENT_SECRET || null,
  oauth2RefreshToken: process.env.OAUTH2_REFRESH_TOKEN || null,

  // Real-time Push & Syndae Inbound Gateway
  enableIdle: process.env.ENABLE_IDLE !== 'false',
  syndaeApiUrl: (process.env.SYNDAE_API_URL || 'http://localhost:3000').replace(/\/$/, ''),
  syndaeAccessKey: process.env.SYNDAE_ACCESS_KEY || 'syndae-local-dev-key',

  // Daemon HTTP Server
  httpPort: parseInt(process.env.HTTP_PORT || '8771', 10),
  httpHost: process.env.HTTP_HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  rootDir: path.resolve(__dirname, '..'),

  // Helper to safely mask email address for logs & status APIs
  maskEmail(email) {
    if (!email || typeof email !== 'string') return 'Not Configured';
    const parts = email.split('@');
    if (parts.length !== 2) return '***';
    const name = parts[0];
    const domain = parts[1];
    const maskedName = name.length <= 2 ? name[0] + '*' : name.slice(0, 2) + '*'.repeat(name.length - 2);
    return `${maskedName}@${domain}`;
  }
};

export default config;
