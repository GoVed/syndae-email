import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS } from '../src/mcp/definitions.js';
import { EmailMcpServer, SERVER_INFO } from '../src/mcp/server.js';
import { StyxEmailRelay } from '../src/email/relay.js';
import { createHttpApp } from '../src/mcp/http.js';
import config from '../src/config.js';

console.log('--- Running Styx Universal Email Connector Tests ---');

// Test 1: Tool definitions and safety policies
console.log('Test 1: Verify MCP tool definitions and safety policies...');
assert.equal(TOOL_DEFINITIONS.length, 5, 'Must expose exactly 5 MCP tools');

const toolNames = TOOL_DEFINITIONS.map(t => t.name);
assert(toolNames.includes('list_emails'), 'Must include list_emails');
assert(toolNames.includes('read_email'), 'Must include read_email');
assert(toolNames.includes('search_emails'), 'Must include search_emails');
assert(toolNames.includes('send_email'), 'Must include send_email');
assert(toolNames.includes('archive_or_mark_email'), 'Must include archive_or_mark_email');

const sendTool = TOOL_DEFINITIONS.find(t => t.name === 'send_email');
assert.equal(sendTool.risk_level, 'HIGH', 'send_email must be HIGH risk');
assert.equal(sendTool.policy, 'REQUIRE_APPROVAL', 'send_email must require approval');

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

// Test 3: MCP Server JSON-RPC Protocol
console.log('Test 3: Verify MCP Server JSON-RPC handshake and tools list...');
const mockEmailClient = {
  isConfigured: () => true,
  getMaskedUser: () => 'us**@example.com',
  connected: true,
  idleActive: true,
  listEmails: async (args) => [
    {
      uid: 101,
      messageId: '<msg101@example.com>',
      from: { name: 'Alice', address: 'alice@example.com' },
      to: ['user@example.com'],
      subject: 'Weekly Status Report',
      date: '2026-09-30T15:00:00Z',
      unread: true,
    }
  ],
  readEmail: async ({ uid }) => ({
    uid,
    messageId: '<msg101@example.com>',
    subject: 'Weekly Status Report',
    from: { name: 'Alice', address: 'alice@example.com' },
    to: [{ name: 'User', address: 'user@example.com' }],
    text: 'All systems operational.',
    date: '2026-09-30T15:00:00Z',
    attachments: [],
  }),
  searchEmails: async ({ query }) => [
    {
      uid: 102,
      subject: `Invoice for ${query}`,
      from: { name: 'Billing', address: 'billing@example.com' },
    }
  ],
  sendEmail: async (params) => ({
    success: true,
    messageId: '<sent-456@example.com>',
    accepted: [params.to],
    response: '250 2.0.0 OK',
  }),
  archiveOrMarkEmail: async ({ uid, action }) => ({
    success: true,
    action: `marked_as_${action}`,
    uid,
  }),
};

const server = new EmailMcpServer(mockEmailClient);

// Test initialize
const initResp = await server.handleJsonRpc({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05' }
});
assert.equal(initResp.result.protocolVersion, '2024-11-05');
assert.equal(initResp.result.serverInfo.name, 'styx-email-server');

// Test tools/list
const listResp = await server.handleJsonRpc({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
});
assert.equal(listResp.result.tools.length, 5);

// Test tools/call list_emails
const callListResp = await server.handleJsonRpc({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name: 'list_emails', arguments: { limit: 5 } }
});
const listData = JSON.parse(callListResp.result.content[0].text);
assert.equal(listData.length, 1);
assert.equal(listData[0].subject, 'Weekly Status Report');

// Test tools/call send_email
const callSendResp = await server.handleJsonRpc({
  jsonrpc: '2.0',
  id: 4,
  method: 'tools/call',
  params: {
    name: 'send_email',
    arguments: {
      to: 'client@company.com',
      subject: 'Project Update',
      body: 'Here is the summary of progress today.',
    }
  }
});
const sendData = JSON.parse(callSendResp.result.content[0].text);
assert.equal(sendData.success, true);
assert.equal(sendData.messageId, '<sent-456@example.com>');

// Test validation error on missing params
const errorResp = await server.handleJsonRpc({
  jsonrpc: '2.0',
  id: 5,
  method: 'tools/call',
  params: { name: 'read_email', arguments: {} } // missing uid
});
assert(errorResp.error);
assert(errorResp.error.message.includes('Missing required argument: uid'));
console.log('✓ MCP Server JSON-RPC handlers verified.');

// Test 4: Inbound Relay Trigger Dispatch
console.log('Test 4: Verify StyxEmailRelay event formatting and dispatch...');
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

const relay = new StyxEmailRelay(mockEmailClient, {
  styxApiUrl: 'http://localhost:3000',
  styxAccessKey: 'test-key-123',
});

await relay.forwardEmailToStyx({
  messageId: '<msg789@work.com>',
  from: { name: 'Colleague Bob', address: 'bob@work.com' },
  subject: 'Urgent: Release Deployment',
  text: 'Can we push the new build to staging today?',
  date: '2026-09-30T17:00:00Z',
  attachments: [{ filename: 'spec.pdf' }],
});

assert.equal(dispatchedUrl, 'http://localhost:3000/api/tools/trigger');
assert.equal(dispatchedBody.protocol, 'email');
assert.equal(dispatchedBody.event_type, 'new_email');
assert.equal(dispatchedBody.channel_id, 'bob@work.com');
assert.equal(dispatchedBody.payload.subject, 'Urgent: Release Deployment');
assert.equal(dispatchedBody.payload.has_attachments, true);
assert.equal(dispatchedHeaders['X-Styx-Access-Key'], 'test-key-123');
console.log('✓ Inbound Relay event formatting and dispatch verified.');

// Test 5: HTTP Endpoints
console.log('Test 5: Verify Express HTTP endpoints (/health and /status)...');
const { app } = createHttpApp({
  emailClient: mockEmailClient,
  mcpServer: server,
  relay,
});

// Verify health check returns healthy
let healthOutput = null;
const mockHealthRes = {
  json: (data) => { healthOutput = data; },
};
const healthRoute = app._router.stack.find(s => s.route && s.route.path === '/health');
assert(healthRoute, 'Health route must exist');
await healthRoute.route.stack[0].handle({}, mockHealthRes);
assert.equal(healthOutput.status, 'healthy');
assert.equal(healthOutput.connected, true);
assert.equal(healthOutput.idleActive, true);

console.log('✓ Express HTTP endpoints verified.');
console.log('\n--- ALL EMAIL CONNECTOR TESTS PASSED ---');
