import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EmailMcpServer, SERVER_INFO } from './server.js';
import { EmailClient } from '../email/client.js';
import { StyxEmailRelay } from '../email/relay.js';
import logger from '../utils/logger.js';
import config from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createHttpApp(options = {}) {
  const app = express();
  app.use(express.json());

  const emailClient = options.emailClient || new EmailClient();
  const mcpServer = options.mcpServer || new EmailMcpServer(emailClient);
  const relay = options.relay || new StyxEmailRelay(emailClient);

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
    res.json({
      status: 'healthy',
      connected: emailClient.connected,
      configured: emailClient.isConfigured(),
      idleActive: emailClient.idleActive,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/status', (req, res) => {
    res.json({
      server: SERVER_INFO,
      provider: config.provider,
      user: emailClient.getMaskedUser(),
      configured: emailClient.isConfigured(),
      connected: emailClient.connected,
      idleActive: emailClient.idleActive,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      relay: relay.stats,
    });
  });

  app.get(['/instructions.md', '/skills/email.md'], (req, res) => {
    const instructionsPath = path.resolve(__dirname, '../../instructions.md');
    if (fs.existsSync(instructionsPath)) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      return res.sendFile(instructionsPath);
    }
    return res.status(404).send('# Styx Email Tool\nUniversal IMAP/SMTP connector.');
  });

  return { app, emailClient, mcpServer, relay };
}

export function startHttpServer(port = config.httpPort, host = config.httpHost) {
  const { app, emailClient, relay } = createHttpApp();

  const server = app.listen(port, host, async () => {
    logger.info({ port, host }, `Styx Email MCP Micro-Daemon listening on http://${host}:${port}`);

    if (emailClient.isConfigured()) {
      try {
        await emailClient.connect();
        await relay.start();
      } catch (err) {
        logger.warn({ err: err.message }, 'Initial email connection attempt failed. Will retry on demand.');
      }
    } else {
      logger.info('Email credentials not set. Daemon ready for runtime configuration or manual testing.');
    }
  });

  const shutdown = async () => {
    logger.info('Shutting down Styx Email Daemon...');
    await emailClient.disconnect();
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
