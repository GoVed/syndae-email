import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS } from '../src/mcp/definitions.js';
import { EmailMcpServer, SERVER_INFO } from '../src/mcp/server.js';
import { AccountManager } from '../src/email/manager.js';
import { SyndaeEmailRelay } from '../src/email/relay.js';
import { createHttpApp } from '../src/mcp/http.js';
import { generatePkcePair, generateAuthUrl } from '../src/auth/oauth.js';
import config from '../src/config.js';

console.log('--- Running Syndae Multi-Account & Modern Auth Email Connector Tests ---');

// Test 1: Tool definitions and safety policies
console.log('Test 1: Verify MCP tool definitions, multi-account params, and safety policies...');
assert.equal(TOOL_DEFINITIONS.length, 8, 'Must expose exactly 8 MCP tools');

const toolNames = TOOL_DEFINITIONS.map(t => t.name);
assert(toolNames.includes('list_accounts'), 'Must include list_accounts');
assert(toolNames.includes('list_folders'), 'Must include list_folders');
assert(toolNames.includes('list_emails'), 'Must include list_emails');
assert(toolNames.includes('read_email'), 'Must include read_email');
assert(toolNames.includes('get_email_link'), 'Must include get_email_link');
assert(toolNames.includes('search_emails'), 'Must include search_emails');
assert(toolNames.includes('send_email'), 'Must include send_email');
assert(toolNames.includes('archive_or_mark_email'), 'Must include archive_or_mark_email');

const getEmailLinkTool = TOOL_DEFINITIONS.find(t => t.name === 'get_email_link');
assert.equal(getEmailLinkTool.risk_level, 'LOW', 'get_email_link must be LOW risk');
assert.equal(getEmailLinkTool.policy, 'AUTONOMOUS', 'get_email_link must be AUTONOMOUS');
assert(getEmailLinkTool.inputSchema.properties.uid, 'get_email_link must require uid');

const listAccountsTool = TOOL_DEFINITIONS.find(t => t.name === 'list_accounts');
assert.equal(listAccountsTool.risk_level, 'LOW', 'list_accounts must be LOW risk');
assert.equal(listAccountsTool.policy, 'AUTONOMOUS', 'list_accounts must be AUTONOMOUS');

const listEmailsTool = TOOL_DEFINITIONS.find(t => t.name === 'list_emails');
assert(listEmailsTool.inputSchema.properties.account, 'list_emails must have optional account parameter');

const sendTool = TOOL_DEFINITIONS.find(t => t.name === 'send_email');
assert.equal(sendTool.risk_level, 'HIGH', 'send_email must be HIGH risk');
assert.equal(sendTool.policy, 'REQUIRE_APPROVAL', 'send_email must require approval');
assert(sendTool.inputSchema.properties.account, 'send_email must have optional account parameter');

const archiveTool = TOOL_DEFINITIONS.find(t => t.name === 'archive_or_mark_email');
assert.equal(archiveTool.risk_level, 'MEDIUM', 'archive_or_mark_email must be MEDIUM risk');
assert.equal(archiveTool.policy, 'REQUIRE_APPROVAL', 'archive_or_mark_email must require approval');
console.log('✓ Tool definitions and policies verified.');

// Test 2: Masking helper and configuration
console.log('Test 2: Verify config masking and provider presets...');
assert.equal(config.maskEmail('developer@domain.com'), 'de*******@domain.com');
assert.equal(config.maskEmail(null), 'Not Configured');
assert.equal(config.maskEmail(''), 'Not Configured');
console.log('✓ Privacy masking verified.');

// Test 3: PKCE and OAuth 2.0 helpers
console.log('Test 3: Verify PKCE generation and OAuth URL generation...');
const { verifier, challenge } = generatePkcePair();
assert(verifier && verifier.length >= 43, 'Verifier must be at least 43 chars');
assert(challenge && challenge.length >= 43, 'Challenge must be at least 43 chars');
assert.notEqual(verifier, challenge, 'Challenge must be SHA-256 transformed from verifier');

const authUrl = generateAuthUrl({
  provider: 'gmail',
  accountId: 'work',
  clientId: 'test-google-client-id.apps.googleusercontent.com',
  redirectUri: 'http://localhost:8771/auth/callback',
  state: 'test-state-123',
  codeChallenge: challenge,
});
assert(authUrl.includes('accounts.google.com'), 'Auth URL must point to accounts.google.com');
assert(authUrl.includes('code_challenge='), 'Auth URL must include PKCE code_challenge');
assert(authUrl.includes('code_challenge_method=S256'), 'Auth URL must use S256 method');
assert(authUrl.includes('access_type=offline'), 'Auth URL must request offline access for refresh token');
console.log('✓ PKCE and Modern Auth URL generation verified.');

// Test 4: AccountManager Multi-Account Registry
console.log('Test 4: Verify AccountManager multi-account aggregation and switching...');
const testStoragePath = '/tmp/syndae-test-accounts-' + Date.now() + '.json';
const manager = new AccountManager({ storagePath: testStoragePath });

const mockWorkClient = {
  id: 'work',
  cfg: { user: 'developer@work.com', provider: 'outlook', enableIdle: true },
  connected: true,
  idleActive: true,
  authType: 'oauth2',
  getSummary: () => ({ id: 'work', user: 'de*******@work.com', provider: 'outlook', connected: true, authType: 'oauth2' }),
  listFolders: async () => [
    { path: 'INBOX', name: 'INBOX', type: 'inbox' },
    { path: 'Sent Items', name: 'Sent Items', type: 'sent', specialUse: '\\Sent' },
  ],
  listEmails: async () => [
    { uid: 201, subject: 'Q3 Product Roadmap', date: '2026-09-30T16:00:00Z', account: 'work' }
  ],
  searchEmails: async ({ query }) => [
    { uid: 201, subject: `Match for ${query} at work`, account: 'work' }
  ],
  readEmail: async ({ uid }) => ({ uid, subject: 'Q3 Product Roadmap', account: 'work' }),
  getEmailLink: async ({ uid, linkId }) => {
    const map = { '1': 'https://promo.deals.com/trk?token=abc' };
    return linkId ? map[linkId] : map;
  },
  sendEmail: async ({ to, subject }) => ({ success: true, messageId: '<sent-work-1@work.com>', account: 'work' }),
  disconnect: async () => {},
};

const mockPersonalClient = {
  id: 'personal',
  cfg: { user: 'user@gmail.com', provider: 'gmail', enableIdle: true },
  connected: true,
  idleActive: true,
  authType: 'oauth2',
  getSummary: () => ({ id: 'personal', user: 'us**@gmail.com', provider: 'gmail', connected: true, authType: 'oauth2' }),
  listFolders: async () => [
    { path: 'INBOX', name: 'INBOX', type: 'inbox' },
    { path: '[Gmail]/Sent Mail', name: 'Sent Mail', type: 'sent', specialUse: '\\Sent' },
    { path: '[Gmail]/Drafts', name: 'Drafts', type: 'drafts', specialUse: '\\Drafts' },
  ],
  listEmails: async () => [
    { uid: 101, subject: 'Dentist Appointment', date: '2026-09-30T17:00:00Z', account: 'personal' }
  ],
  searchEmails: async ({ query }) => [
    { uid: 101, subject: `Match for ${query} in personal`, account: 'personal' }
  ],
  readEmail: async ({ uid }) => ({ uid, subject: 'Dentist Appointment', account: 'personal' }),
  getEmailLink: async ({ uid, linkId }) => {
    const map = { '1': 'https://personal-promo.com/track?id=xyz' };
    return linkId ? map[linkId] : map;
  },
  sendEmail: async ({ to, subject }) => ({ success: true, messageId: '<sent-pers-1@gmail.com>', account: 'personal' }),
  disconnect: async () => {},
};

manager.accounts.set('work', mockWorkClient);
manager.accounts.set('personal', mockPersonalClient);

const accountSummaries = manager.listAccounts();
assert.equal(accountSummaries.length, 2, 'Must list 2 configured accounts');
assert.equal(accountSummaries[0].id, 'work');
assert.equal(accountSummaries[1].id, 'personal');

// Verify aggregated listEmails (sorted descending by date)
const allEmails = await manager.listEmails();
assert.equal(allEmails.length, 2, 'Aggregated emails should return 2 items');
assert.equal(allEmails[0].subject, 'Dentist Appointment', 'Most recent email (17:00) should be first');
assert.equal(allEmails[1].subject, 'Q3 Product Roadmap', 'Earlier email (16:00) should be second');

// Verify specific account query
const workOnly = await manager.listEmails({ account: 'work' });
assert.equal(workOnly.length, 1);
assert.equal(workOnly[0].account, 'work');

// Verify getEmailLink on manager
const linkUrl = await manager.getEmailLink({ account: 'work', uid: 201, linkId: '1' });
assert.equal(linkUrl, 'https://promo.deals.com/trk?token=abc');

// Verify account-specific send
const sendRes = await manager.sendEmail({ account: 'work', to: 'boss@work.com', subject: 'Report', body: 'Done' });
assert.equal(sendRes.account, 'work');
assert.equal(sendRes.messageId, '<sent-work-1@work.com>');
console.log('✓ AccountManager multi-account registry verified.');

// Test 5: MCP Server JSON-RPC Protocol with AccountManager
console.log('Test 5: Verify MCP Server JSON-RPC protocol with list_accounts and multi-account calls...');
const server = new EmailMcpServer(manager);

// Test initialize
const initResp = await server.handleJsonRpc({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05' }
});
assert.equal(initResp.result.protocolVersion, '2024-11-05');
assert.equal(initResp.result.serverInfo.name, 'syndae-email-server');

// Test tools/list
const listToolsResp = await server.handleJsonRpc({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
});
assert.equal(listToolsResp.result.tools.length, 8);

// Test tools/call list_accounts
const callListAccountsResp = await server.handleJsonRpc({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name: 'list_accounts', arguments: {} }
});
const accountsData = JSON.parse(callListAccountsResp.result.content[0].text);
assert.equal(accountsData.length, 2);
assert.equal(accountsData[0].id, 'work');

// Test tools/call list_folders
const callListFoldersResp = await server.handleJsonRpc({
  jsonrpc: '2.0',
  id: 35,
  method: 'tools/call',
  params: { name: 'list_folders', arguments: { account: 'personal' } }
});
const foldersData = JSON.parse(callListFoldersResp.result.content[0].text);
assert.equal(foldersData.length, 3);
assert.equal(foldersData[1].path, '[Gmail]/Sent Mail');

// Test tools/call list_emails with specific account
const callListResp = await server.handleJsonRpc({
  jsonrpc: '2.0',
  id: 4,
  method: 'tools/call',
  params: { name: 'list_emails', arguments: { account: 'personal' } }
});
const listData = JSON.parse(callListResp.result.content[0].text);
assert.equal(listData.length, 1);
assert.equal(listData[0].subject, 'Dentist Appointment');

// Test tools/call get_email_link
const callGetLinkResp = await server.handleJsonRpc({
  jsonrpc: '2.0',
  id: 5,
  method: 'tools/call',
  params: { name: 'get_email_link', arguments: { account: 'work', uid: 201, link_id: '1' } }
});
const linkData = callGetLinkResp.result.content[0].text;
assert.equal(linkData, 'https://promo.deals.com/trk?token=abc');
console.log('✓ MCP Server JSON-RPC multi-account handlers verified.');

// Test 6: Inbound Relay Trigger Dispatch with Account Tagging
console.log('Test 6: Verify SyndaeEmailRelay multi-account event formatting and dispatch...');
let dispatchedUrl = null;
let dispatchedBody = null;
let dispatchedHeaders = null;

global.fetch = async (url, options) => {
  dispatchedUrl = url;
  dispatchedBody = JSON.parse(options.body);
  dispatchedHeaders = options.headers;
  return {
    ok: true,
    json: async () => ({
      success: true,
      session_id: 'email-sess-123',
      turn_id: 'turn-abc',
      ignored: false,
    }),
  };
};

const relay = new SyndaeEmailRelay(manager, {
  syndaeApiUrl: 'http://localhost:3000',
  syndaeAccessKey: 'test-key-123',
});

await relay.forwardEmailToSyndae({
  messageId: '<msg789@work.com>',
  from: { name: 'Colleague Bob', address: 'bob@work.com' },
  subject: 'Urgent: Release Deployment',
  text: 'Can we push the new build to staging today?',
  date: '2026-09-30T17:00:00Z',
  attachments: [{ filename: 'spec.pdf' }],
}, 'work');

assert.equal(dispatchedUrl, 'http://localhost:3000/api/tools/trigger');
assert.equal(dispatchedBody.protocol, 'email');
assert.equal(dispatchedBody.event_type, 'new_email');
assert.equal(dispatchedBody.channel_id, 'bob@work.com');
assert.equal(dispatchedBody.source_id, '[work] Colleague Bob <bob@work.com>');
assert.equal(dispatchedBody.payload.account, 'work');
assert.equal(dispatchedBody.payload.subject, 'Urgent: Release Deployment');
assert.equal(dispatchedBody.payload.has_attachments, true);
assert.equal(dispatchedHeaders['X-Syndae-Access-Key'], 'test-key-123');

// Test link shortening in relay
await relay.forwardEmailToSyndae({
  uid: 105,
  messageId: '<promo123@deals.com>',
  from: { name: 'Super Deals', address: 'deals@store.com' },
  subject: 'Huge Savings Event',
  text: 'Don\'t miss out: https://promo.store.com/click/track?utm_source=fall_email&utm_campaign=mega&token=abcdef1234567890abcdef1234567890\nAlso check https://syndae.org',
  date: '2026-09-30T17:00:00Z',
}, 'work');

assert.equal(dispatchedBody.payload.links_count, 1, 'Should detect and shorten 1 promotional link');
assert(dispatchedBody.payload.text.includes('[Link #1: promo.store.com'), 'Link should be shortened in payload text');
assert(dispatchedBody.payload.text.includes('https://syndae.org'), 'Short non-promotional link should be preserved');
assert(!dispatchedBody.payload.text.includes('token=abcdef1234567890'), 'Bloated tokens must NOT be present in payload text');

console.log('✓ Inbound Relay multi-account event formatting and link shortening verified.');

// Test 7: HTTP Endpoints (/health, /status, /accounts, /links/:account/:uid/:link_id, /auth/connect)
console.log('Test 7: Verify Express HTTP endpoints (/health, /status, /accounts, /links, /auth/connect)...');
const { app } = createHttpApp({
  accountManager: manager,
  mcpServer: server,
  relay,
});

// Verify health check
let healthOutput = null;
const mockHealthRes = { json: (data) => { healthOutput = data; } };
const healthRoute = app._router.stack.find(s => s.route && s.route.path === '/health');
assert(healthRoute, 'Health route must exist');
await healthRoute.route.stack[0].handle({}, mockHealthRes);
assert.equal(healthOutput.status, 'healthy');
assert.equal(healthOutput.connected, true);
assert.equal(healthOutput.totalAccounts, 2);

// Verify /accounts endpoint
let accountsOutput = null;
const mockAccountsRes = { json: (data) => { accountsOutput = data; } };
const accountsRoute = app._router.stack.find(s => s.route && s.route.path === '/accounts');
assert(accountsRoute, 'Accounts route must exist');
await accountsRoute.route.stack[0].handle({}, mockAccountsRes);
assert.equal(accountsOutput.accounts.length, 2);

// Verify /links/:account/:uid/:link_id redirect endpoint
let redirectUrl = null;
const mockLinkRes = {
  redirect: (url) => { redirectUrl = url; },
  status: () => ({ send: () => {} }),
};
const linksRoute = app._router.stack.find(s => s.route && s.route.path === '/links/:account/:uid/:link_id');
assert(linksRoute, 'Links redirect route must exist');
await linksRoute.route.stack[0].handle({
  params: { account: 'work', uid: '201', link_id: '1' }
}, mockLinkRes);
assert.equal(redirectUrl, 'https://promo.deals.com/trk?token=abc', 'Links endpoint must 302 redirect to original destination');

// Verify /auth/connect endpoint renders HTML config form when credentials not yet set
let connectOutput = null;
const mockConnectRes = {
  send: (html) => { connectOutput = html; },
  redirect: (url) => { connectOutput = url; },
};
const connectRoute = app._router.stack.find(s => s.route && s.route.path === '/auth/connect');
assert(connectRoute, 'Auth connect route must exist');
await connectRoute.route.stack[0].handle({
  query: { provider: 'gmail', account: 'testacc' },
  get: () => 'localhost:8771',
  protocol: 'http',
}, mockConnectRes);
assert(connectOutput.includes('Google Gmail'), 'Auth connect must render provider configuration page');
assert(connectOutput.includes('/auth/callback'), 'Auth connect must show authorized redirect URI');

console.log('✓ Express HTTP endpoints and Modern Auth web flows verified.');

// Test 8: Verify urlShortener link compression and deduplication
console.log('Test 8: Verify urlShortener link compression, deduplication, and label formatting...');
const { shortenEmailLinks, isPromotionalOrLong } = await import('../src/utils/urlShortener.js');

assert.equal(isPromotionalOrLong('https://syndae.org/docs'), false);
assert.equal(isPromotionalOrLong('https://promo.store.com/trk?utm_source=email&token=1234567890abcdef1234567890'), true);

const testText = 'Promo: https://promo.store.com/trk?utm_source=email&token=1234567890abcdef1234567890\nDup: https://promo.store.com/trk?utm_source=email&token=1234567890abcdef1234567890\nDoc: https://syndae.org';
const shortRes = shortenEmailLinks(testText, { account: 'testacc', uid: 99 });
assert.equal(shortRes.count, 1, 'Duplicate URLs should reuse the same link index');
assert(shortRes.text.includes('[Link #1: promo.store.com]'));
assert(shortRes.text.includes('https://syndae.org'));
assert.equal(shortRes.links['1'], 'https://promo.store.com/trk?utm_source=email&token=1234567890abcdef1234567890');
console.log('✓ urlShortener compression and deduplication verified.');

// Test 9: Verify EmailClient folder resolution & semantic aliases
console.log('Test 9: Verify EmailClient folder resolution & semantic aliases...');
const { EmailClient } = await import('../src/email/client.js');
const testClient = new EmailClient({ user: 'tester@gmail.com', pass: 'secret' });
testClient._cachedMailboxes = [
  { path: 'INBOX', name: 'INBOX', type: 'inbox' },
  { path: '[Gmail]/Sent Mail', name: 'Sent Mail', type: 'sent', specialUse: '\\Sent' },
  { path: '[Gmail]/Drafts', name: 'Drafts', type: 'drafts', specialUse: '\\Drafts' },
  { path: '[Gmail]/Trash', name: 'Trash', type: 'trash', specialUse: '\\Trash' },
  { path: '[Gmail]/Spam', name: 'Spam', type: 'spam', specialUse: '\\Junk' },
  { path: '[Gmail]/All Mail', name: 'All Mail', type: 'archive', specialUse: '\\All' },
  { path: 'Work', name: 'Work', type: 'custom' },
];
testClient._cachedMailboxesTime = Date.now();

assert.equal(await testClient.resolveFolder('Sent'), '[Gmail]/Sent Mail');
assert.equal(await testClient.resolveFolder('sent'), '[Gmail]/Sent Mail');
assert.equal(await testClient.resolveFolder('sent mail'), '[Gmail]/Sent Mail');
assert.equal(await testClient.resolveFolder('sent items'), '[Gmail]/Sent Mail');
assert.equal(await testClient.resolveFolder('drafts'), '[Gmail]/Drafts');
assert.equal(await testClient.resolveFolder('trash'), '[Gmail]/Trash');
assert.equal(await testClient.resolveFolder('spam'), '[Gmail]/Spam');
assert.equal(await testClient.resolveFolder('all mail'), '[Gmail]/All Mail');
assert.equal(await testClient.resolveFolder('archive'), '[Gmail]/All Mail');
assert.equal(await testClient.resolveFolder('INBOX'), 'INBOX');
assert.equal(await testClient.resolveFolder('Work'), 'Work');
assert.equal(await testClient.resolveFolder(''), 'INBOX');
console.log('✓ EmailClient folder resolution & semantic aliases verified.');

console.log('\n--- ALL MULTI-ACCOUNT & MODERN AUTH EMAIL TESTS PASSED ---');
