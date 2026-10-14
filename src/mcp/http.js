import dns from 'dns';
import express from 'express';
import fs from 'fs';
import path from 'path';

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { EmailMcpServer, SERVER_INFO } from './server.js';
import { AccountManager } from '../email/manager.js';
import { EmailClient } from '../email/client.js';
import { SyndaeEmailRelay } from '../email/relay.js';
import {
  OAUTH_PROVIDERS,
  generatePkcePair,
  generateAuthUrl,
  exchangeCodeForTokens,
  fetchUserProfile,
} from '../auth/oauth.js';
import {
  renderMailboxDashboardHtml,
  renderOAuthConfigHtml,
  renderOAuthSuccessHtml,
  renderOAuthErrorHtml,
} from './ui.js';
import logger from '../utils/logger.js';
import config from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory pending OAuth PKCE session store: state -> session
const pendingOAuthSessions = new Map();

function cleanPendingOAuthSessions() {
  const now = Date.now();
  for (const [state, sess] of pendingOAuthSessions.entries()) {
    if (sess.expiresAt < now) pendingOAuthSessions.delete(state);
  }
}

export function createHttpApp(options = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  let accountManager = options.accountManager;
  let emailClient = options.emailClient;

  if (!accountManager) {
    accountManager = new AccountManager();
    if (emailClient) {
      accountManager.accounts.set(emailClient.id || 'primary', emailClient);
    }
  }

  const mcpServer = options.mcpServer || new EmailMcpServer(accountManager);
  const relay = options.relay || new SyndaeEmailRelay(accountManager);
  accountManager.relay = relay;

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Syndae-Access-Key');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Interactive Web Dashboard on GET / and GET /setup
  app.get(['/', '/setup'], (req, res) => {
    const html = renderMailboxDashboardHtml(accountManager.listAccounts(), relay.stats);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // MCP JSON-RPC Handler for POST / and POST /mcp
  const jsonRpcHandler = async (req, res) => {
    try {
      const resp = await mcpServer.handleJsonRpc(req.body);
      if (resp) return res.json(resp);
      return res.status(204).end();
    } catch (err) {
      logger.error({ err }, 'Error in email HTTP JSON-RPC handler');
      return res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: { code: -32603, message: err.message },
      });
    }
  };

  app.post('/', jsonRpcHandler);
  app.post('/mcp', jsonRpcHandler);

  app.get('/health', (req, res) => {
    const accounts = accountManager.listAccounts();
    const isConnected = accounts.some(a => a.connected) || (emailClient && emailClient.connected);
    const isConfigured = accounts.length > 0 || (emailClient && emailClient.isConfigured());
    const isIdle = accounts.some(a => a.idleActive) || (emailClient && emailClient.idleActive);
    res.json({
      status: 'healthy',
      totalAccounts: accounts.length,
      connected: Boolean(isConnected),
      configured: Boolean(isConfigured),
      idleActive: Boolean(isIdle),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/status', (req, res) => {
    const accounts = accountManager.listAccounts();
    res.json({
      server: SERVER_INFO,
      provider: config.provider,
      user: emailClient ? emailClient.getMaskedUser() : (accounts[0]?.user || 'Not Configured'),
      totalAccounts: accounts.length,
      accounts,
      configured: accounts.length > 0 || (emailClient && emailClient.isConfigured()),
      connected: accounts.some(a => a.connected) || (emailClient && emailClient.connected),
      idleActive: accounts.some(a => a.idleActive) || (emailClient && emailClient.idleActive),
      relay: relay.stats,
    });
  });

  app.get('/accounts', (req, res) => {
    res.json({ accounts: accountManager.listAccounts() });
  });

  // Shortened Link Redirection & Access Endpoint (Fast 302 Redirect to destination)
  app.get('/links/:account/:uid/:link_id', async (req, res) => {
    try {
      const { account, uid, link_id } = req.params;
      const parsedUid = parseInt(uid, 10);
      const url = await accountManager.getEmailLink({ account, uid: parsedUid, linkId: link_id });
      if (url && typeof url === 'string') {
        return res.redirect(url);
      }
      return res.status(404).send(`<h3>Link #${link_id} not found for email UID ${uid}</h3>`);
    } catch (err) {
      logger.error({ err: err.message, params: req.params }, 'Error resolving shortened email link');
      return res.status(500).send(`<h3>Error resolving link: ${err.message}</h3>`);
    }
  });

  // Direct Account Addition (App Passwords or Static Keys - 10-Second Setup)
  app.post('/accounts/add', async (req, res) => {
    try {
      const { id, provider, user, pass, imapHost, imapPort, smtpHost, smtpPort } = req.body || {};
      if (!user) return res.status(400).json({ success: false, error: 'Missing email address' });
      if (!pass) return res.status(400).json({ success: false, error: 'Missing password or App Password' });

      logger.info({ provider, user: config.maskEmail(user) }, 'Attempting direct mailbox connection');

      let cleanPass = pass.trim();
      if ((provider === 'gmail' || (!provider && user.includes('@gmail.com'))) && cleanPass.includes(' ')) {
        cleanPass = cleanPass.replace(/\s+/g, '');
      }

      const account = await accountManager.addAccount({
        id: id || user.split('@')[0],
        provider: provider || 'gmail',
        user: user.trim(),
        pass: cleanPass,
        imapHost: imapHost || undefined,
        imapPort: imapPort ? parseInt(imapPort, 10) : undefined,
        smtpHost: smtpHost || undefined,
        smtpPort: smtpPort ? parseInt(smtpPort, 10) : undefined,
      });

      res.json({ success: true, account });
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to connect email account');
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/accounts/remove', async (req, res) => {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing account id' });
      const result = await accountManager.removeAccount(id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Modern Auth 1-Click Connect Endpoint (Google Cloud OAuth 2.0 PKCE)
  app.get('/auth/connect', (req, res) => {
    cleanPendingOAuthSessions();
    const provider = (req.query.provider || 'gmail').toLowerCase();
    const accountId = (req.query.account || provider).toLowerCase();
    const provConfig = OAUTH_PROVIDERS[provider];

    if (!provConfig) {
      return res.status(400).send(`Unsupported provider: ${provider}. Supported: gmail, outlook`);
    }

    const clientId = req.query.client_id ||
      (provider === 'gmail' ? process.env.GMAIL_CLIENT_ID : process.env.OUTLOOK_CLIENT_ID) ||
      config.oauth2ClientId;

    const clientSecret = req.query.client_secret ||
      (provider === 'gmail' ? process.env.GMAIL_CLIENT_SECRET : process.env.OUTLOOK_CLIENT_SECRET) ||
      config.oauth2ClientSecret;

    const host = req.get('host') || `localhost:${config.httpPort}`;
    const redirectUri = `${req.protocol || 'http'}://${host}/auth/callback`;

    if (!clientId) {
      return res.send(renderOAuthConfigHtml({ provider, accountId, redirectUri }));
    }

    const { verifier, challenge } = generatePkcePair();
    const state = crypto.randomBytes(16).toString('hex');

    pendingOAuthSessions.set(state, {
      provider,
      accountId,
      codeVerifier: verifier,
      clientId,
      clientSecret,
      redirectUri,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    const authUrl = generateAuthUrl({
      provider,
      accountId,
      clientId,
      redirectUri,
      state,
      codeChallenge: challenge,
    });

    res.redirect(authUrl);
  });

  // Modern Auth OAuth Callback Endpoint
  app.get('/auth/callback', async (req, res) => {
    cleanPendingOAuthSessions();
    const { code, state, error, error_description } = req.query;

    if (error) {
      logger.error({ error, error_description }, 'OAuth authorization denied');
      return res.status(400).send(renderOAuthErrorHtml(`OAuth error: ${error} - ${error_description || ''}`));
    }

    if (!code || !state) {
      return res.status(400).send(renderOAuthErrorHtml('Missing authorization code or state parameter'));
    }

    const session = pendingOAuthSessions.get(state);
    if (!session || session.expiresAt < Date.now()) {
      pendingOAuthSessions.delete(state);
      return res.status(400).send(renderOAuthErrorHtml('OAuth session expired. Please connect again.'));
    }

    pendingOAuthSessions.delete(state);

    try {
      const tokens = await exchangeCodeForTokens({
        provider: session.provider,
        code,
        clientId: session.clientId,
        clientSecret: session.clientSecret,
        redirectUri: session.redirectUri,
        codeVerifier: session.codeVerifier,
      });

      const profile = await fetchUserProfile({
        provider: session.provider,
        accessToken: tokens.accessToken,
      });

      const userEmail = profile?.email || `${session.accountId}@auth.syndae`;
      const accountSummary = await accountManager.addAccount({
        id: session.accountId,
        provider: session.provider,
        user: userEmail,
        oauth2ClientId: session.clientId,
        oauth2ClientSecret: session.clientSecret,
        oauth2RefreshToken: tokens.refreshToken,
      });

      res.send(renderOAuthSuccessHtml({
        account: accountSummary,
        email: userEmail,
        provider: session.provider,
      }));
    } catch (err) {
      logger.error({ err: err.message }, 'OAuth callback exchange failed');
      res.status(500).send(renderOAuthErrorHtml(err.message));
    }
  });

  app.get(['/instructions.md', '/skills/email.md'], (req, res) => {
    const instructionsPath = path.resolve(__dirname, '../../instructions.md');
    if (fs.existsSync(instructionsPath)) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      return res.sendFile(instructionsPath);
    }
    return res.status(404).send('# Syndae Email Tool\nUniversal IMAP/SMTP connector.');
  });

  return { app, emailClient, accountManager, mcpServer, relay };
}

export async function startHttpServer(port = config.httpPort, host = config.httpHost) {
  const accountManager = new AccountManager();
  await accountManager.init();

  const { app, relay } = createHttpApp({ accountManager });
  accountManager.relay = relay;

  const server = app.listen(port, host, async () => {
    logger.info({ port, host }, `Syndae Email MCP Micro-Daemon listening on http://${host}:${port}`);
    await accountManager.connectAll();
    await relay.start();
  });

  const shutdown = async () => {
    logger.info('Shutting down Syndae Email Daemon...');
    accountManager.stopWatchdog();
    for (const client of accountManager.accounts.values()) {
      await client.disconnect().catch(() => {});
    }
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

export default { createHttpApp, startHttpServer };
