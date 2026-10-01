import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { EmailMcpServer, SERVER_INFO } from './server.js';
import { AccountManager } from '../email/manager.js';
import { EmailClient } from '../email/client.js';
import { StyxEmailRelay } from '../email/relay.js';
import {
  OAUTH_PROVIDERS,
  generatePkcePair,
  generateAuthUrl,
  exchangeCodeForTokens,
  fetchUserProfile,
} from '../auth/oauth.js';
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

  let accountManager = options.accountManager;
  let emailClient = options.emailClient;

  if (!accountManager) {
    accountManager = new AccountManager();
    if (emailClient) {
      accountManager.accounts.set(emailClient.id || 'primary', emailClient);
    }
  }

  const mcpServer = options.mcpServer || new EmailMcpServer(accountManager);
  const relay = options.relay || new StyxEmailRelay(accountManager);
  accountManager.relay = relay;

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Styx-Access-Key');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

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

  // Modern Auth 1-Click Connect Endpoint
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

      const userEmail = profile?.email || `${session.accountId}@auth.styx`;
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
    return res.status(404).send('# Styx Email Tool\nUniversal IMAP/SMTP connector.');
  });

  return { app, emailClient, accountManager, mcpServer, relay };
}

function renderOAuthConfigHtml({ provider, accountId, redirectUri }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connect ${provider.toUpperCase()} - Styx Agent OS</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2rem; max-width: 520px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
    h2 { margin-top: 0; color: #38bdf8; font-size: 1.4rem; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
    label { display: block; margin-top: 1rem; font-weight: 500; font-size: 0.85rem; color: #cbd5e1; }
    input { width: 100%; box-sizing: border-box; padding: 0.65rem; margin-top: 0.3rem; background: #0f172a; border: 1px solid #475569; border-radius: 6px; color: #fff; font-size: 0.9rem; }
    .btn { display: inline-block; margin-top: 1.5rem; width: 100%; box-sizing: border-box; background: #0284c7; color: #fff; border: none; padding: 0.75rem; border-radius: 6px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
    .btn:hover { background: #0369a1; }
    .code-box { background: #0f172a; padding: 0.5rem; border-radius: 4px; font-family: monospace; font-size: 0.8rem; word-break: break-all; color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Connect ${provider === 'gmail' ? 'Google Gmail' : 'Microsoft Outlook'} (OAuth 2.0)</h2>
    <p>To authorize Styx to read and send emails using Modern Auth without storing static passwords, enter your OAuth App credentials below:</p>
    <div style="margin-bottom: 1rem;">
      <span style="font-size:0.8rem; color:#94a3b8;">Authorized Redirect URI:</span>
      <div class="code-box">${redirectUri}</div>
    </div>
    <form method="GET" action="/auth/connect">
      <input type="hidden" name="provider" value="${provider}">
      <label>Account ID / Mailbox Label (e.g. personal, work, school)</label>
      <input type="text" name="account" value="${accountId}" required>
      <label>Client ID</label>
      <input type="text" name="client_id" placeholder="Your OAuth Client ID" required>
      <label>Client Secret (Optional if using PKCE public client)</label>
      <input type="password" name="client_secret" placeholder="Your OAuth Client Secret">
      <button type="submit" class="btn">Continue to Provider Login &rarr;</button>
    </form>
  </div>
</body>
</html>`;
}

function renderOAuthSuccessHtml({ account, email, provider }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connected - Styx Agent OS</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; border: 1px solid #10b981; border-radius: 12px; padding: 2.5rem; max-width: 480px; width: 90%; text-align: center; }
    .icon { font-size: 3rem; color: #10b981; margin-bottom: 1rem; }
    h2 { margin: 0; color: #f8fafc; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
    .badge { display: inline-block; background: #064e3b; color: #6ee7b7; padding: 0.3rem 0.8rem; border-radius: 9999px; font-size: 0.85rem; font-weight: 500; margin: 0.5rem 0; }
    .btn { display: inline-block; margin-top: 1.5rem; background: #0284c7; color: #fff; padding: 0.75rem 1.5rem; border-radius: 6px; font-weight: 600; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h2>Account Connected!</h2>
    <div class="badge">${provider.toUpperCase()} &bull; ${account.id}</div>
    <p>Successfully authenticated <strong>${email}</strong> with OAuth 2.0 refresh tokens. IMAP IDLE real-time push is now active.</p>
    <a href="/status" class="btn">View Status</a>
  </div>
</body>
</html>`;
}

function renderOAuthErrorHtml(errorMsg) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connection Error - Styx</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; border: 1px solid #ef4444; border-radius: 12px; padding: 2.5rem; max-width: 480px; width: 90%; text-align: center; }
    .icon { font-size: 3rem; color: #ef4444; margin-bottom: 1rem; }
    h2 { margin: 0; color: #f8fafc; }
    p { color: #fca5a5; font-size: 0.95rem; line-height: 1.5; }
    .btn { display: inline-block; margin-top: 1.5rem; background: #334155; color: #fff; padding: 0.75rem 1.5rem; border-radius: 6px; font-weight: 600; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✕</div>
    <h2>Connection Failed</h2>
    <p>${errorMsg}</p>
    <a href="/auth/connect" class="btn">Try Again</a>
  </div>
</body>
</html>`;
}

export async function startHttpServer(port = config.httpPort, host = config.httpHost) {
  const accountManager = new AccountManager();
  await accountManager.init();

  const { app, relay } = createHttpApp({ accountManager });
  accountManager.relay = relay;

  const server = app.listen(port, host, async () => {
    logger.info({ port, host }, `Styx Email MCP Micro-Daemon listening on http://${host}:${port}`);
    await accountManager.connectAll();
    await relay.start();
  });

  const shutdown = async () => {
    logger.info('Shutting down Styx Email Daemon...');
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
