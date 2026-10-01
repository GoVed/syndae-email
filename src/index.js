import dns from 'dns';
import { Command } from 'commander';
import { startHttpServer } from './mcp/http.js';
import { AccountManager } from './email/manager.js';
import { EmailClient } from './email/client.js';

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const program = new Command();

program
  .name('styx-email')
  .description('Styx Universal Email MCP Micro-Daemon (Multi-Account IMAP & SMTP)')
  .version('1.0.0');

program
  .command('daemon')
  .description('Start the Email MCP HTTP daemon')
  .option('-p, --port <port>', 'Port to listen on', '8771')
  .option('-h, --host <host>', 'Host to bind to', '0.0.0.0')
  .action(opts => {
    startHttpServer(parseInt(opts.port, 10), opts.host);
  });

program
  .command('accounts')
  .description('List configured email accounts')
  .action(async () => {
    const manager = new AccountManager();
    await manager.init();
    console.log(JSON.stringify(manager.listAccounts(), null, 2));
  });

program
  .command('list')
  .description('List recent emails from inbox')
  .option('-a, --account <account>', 'Account ID (default: all or primary)')
  .option('-l, --limit <limit>', 'Max emails to list', '10')
  .option('-u, --unread', 'Show unread only')
  .action(async opts => {
    const manager = new AccountManager();
    await manager.init();
    try {
      await manager.connectAll();
      const emails = await manager.listEmails({
        account: opts.account,
        limit: parseInt(opts.limit, 10),
        unreadOnly: Boolean(opts.unread),
      });
      console.log(JSON.stringify(emails, null, 2));
    } catch (err) {
      console.error('List failed:', err.message);
      process.exit(1);
    } finally {
      for (const c of manager.accounts.values()) await c.disconnect();
    }
  });

program
  .command('send')
  .description('Send an email via SMTP')
  .option('-a, --account <account>', 'Account ID to send from')
  .requiredOption('-t, --to <to>', 'Recipient email')
  .requiredOption('-s, --subject <subject>', 'Subject')
  .requiredOption('-b, --body <body>', 'Body text')
  .action(async opts => {
    const manager = new AccountManager();
    await manager.init();
    try {
      await manager.connectAll();
      const res = await manager.sendEmail({
        account: opts.account,
        to: opts.to,
        subject: opts.subject,
        body: opts.body,
      });
      console.log('Email sent successfully:', res);
    } catch (err) {
      console.error('Send failed:', err.message);
      process.exit(1);
    } finally {
      for (const c of manager.accounts.values()) await c.disconnect();
    }
  });

if (process.argv.length <= 2) {
  startHttpServer();
} else {
  program.parse(process.argv);
}

export * from './email/client.js';
export * from './email/manager.js';
export * from './email/relay.js';
export * from './auth/oauth.js';
export * from './mcp/server.js';
export * from './mcp/definitions.js';
