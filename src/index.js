import { Command } from 'commander';
import { startHttpServer } from './mcp/http.js';
import { EmailClient } from './email/client.js';

const program = new Command();

program
  .name('styx-email')
  .description('Styx Universal Email MCP Micro-Daemon (IMAP & SMTP)')
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
  .command('list')
  .description('List recent emails from inbox')
  .option('-l, --limit <limit>', 'Max emails to list', '10')
  .option('-u, --unread', 'Show unread only')
  .action(async opts => {
    const client = new EmailClient();
    try {
      await client.connect();
      const emails = await client.listEmails({
        limit: parseInt(opts.limit, 10),
        unreadOnly: Boolean(opts.unread),
      });
      console.log(JSON.stringify(emails, null, 2));
    } catch (err) {
      console.error('List failed:', err.message);
      process.exit(1);
    } finally {
      await client.disconnect();
    }
  });

program
  .command('send')
  .description('Send an email via SMTP')
  .requiredOption('-t, --to <to>', 'Recipient email')
  .requiredOption('-s, --subject <subject>', 'Subject')
  .requiredOption('-b, --body <body>', 'Body text')
  .action(async opts => {
    const client = new EmailClient();
    try {
      await client.connect();
      const res = await client.sendEmail({
        to: opts.to,
        subject: opts.subject,
        text: opts.body,
      });
      console.log('Email sent successfully:', res);
    } catch (err) {
      console.error('Send failed:', err.message);
      process.exit(1);
    } finally {
      await client.disconnect();
    }
  });

if (process.argv.length <= 2) {
  startHttpServer();
} else {
  program.parse(process.argv);
}

export * from './email/client.js';
export * from './email/relay.js';
export * from './mcp/server.js';
export * from './mcp/definitions.js';
