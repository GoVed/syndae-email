/**
 * Web UI templates for Styx Email MCP Micro-Daemon
 */

export function renderMailboxDashboardHtml(accounts = [], stats = {}) {
  const accountCards = accounts.length === 0
    ? `<div class="empty-state">
        <div style="font-size:2rem; margin-bottom:0.5rem;">📬</div>
        <div style="font-weight:600; color:#f8fafc;">No Mailboxes Connected Yet</div>
        <div style="color:#94a3b8; font-size:0.85rem; margin-top:0.3rem;">
          Connect your Gmail or Outlook account below in 10 seconds to enable autonomous email reading and real-time push.
        </div>
      </div>`
    : accounts.map(acc => `
      <div class="account-card" id="card-${acc.id}">
        <div class="acc-header">
          <div>
            <span class="acc-id">${acc.id}</span>
            <span class="provider-badge">${acc.provider.toUpperCase()}</span>
            <span class="auth-badge">${acc.authType === 'oauth2' ? 'OAuth 2.0' : 'App Password'}</span>
          </div>
          <div>
            <button class="btn-danger-sm" onclick="disconnectAccount('${acc.id}')">Disconnect</button>
          </div>
        </div>
        <div class="acc-email">${acc.user}</div>
        <div class="acc-footer">
          <span class="status-indicator ${acc.connected ? 'online' : 'offline'}"></span>
          <span>${acc.connected ? 'Connected' : 'Disconnected'}</span>
          <span style="margin: 0 0.5rem; color:#475569;">•</span>
          <span style="color: ${acc.idleActive ? '#38bdf8' : '#64748b'}; font-size:0.8rem;">
            ${acc.idleActive ? '⚡ IMAP IDLE Push Active' : 'Push Idle'}
          </span>
        </div>
      </div>
    `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Styx Email Hub</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --accent: #38bdf8;
      --accent-hover: #0284c7;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #10b981;
      --danger: #ef4444;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 2rem 1rem;
      display: flex;
      justify-content: center;
    }
    .container {
      max-width: 720px;
      width: 100%;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
    }
    .title-group h1 {
      margin: 0;
      font-size: 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-top: 0.25rem;
    }
    .badge-live {
      background: #064e3b;
      color: #6ee7b7;
      border: 1px solid #059669;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .section-title {
      font-size: 1.05rem;
      font-weight: 600;
      margin: 1.5rem 0 0.75rem 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .accounts-grid {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .account-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem 1.25rem;
    }
    .acc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .acc-id {
      font-weight: 700;
      font-size: 1rem;
      color: #fff;
    }
    .provider-badge {
      background: #334155;
      color: #94a3b8;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      margin-left: 0.4rem;
    }
    .auth-badge {
      background: #1e1b4b;
      color: #a5b4fc;
      border: 1px solid #3730a3;
      font-size: 0.7rem;
      font-weight: 500;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      margin-left: 0.3rem;
    }
    .acc-email {
      font-size: 0.9rem;
      color: #cbd5e1;
      margin-top: 0.3rem;
      font-family: monospace;
    }
    .acc-footer {
      display: flex;
      align-items: center;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 0.6rem;
    }
    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 0.4rem;
    }
    .status-indicator.online { background: var(--success); box-shadow: 0 0 8px rgba(16,185,129,0.5); }
    .status-indicator.offline { background: var(--danger); }
    .empty-state {
      background: var(--card-bg);
      border: 1px dashed var(--border);
      border-radius: 10px;
      padding: 2.5rem;
      text-align: center;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      margin-top: 1rem;
    }
    .tab-bar {
      display: flex;
      gap: 0.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.75rem;
      margin-bottom: 1rem;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 0.5rem 0.9rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    .tab-btn.active {
      background: #0f172a;
      border-color: var(--border);
      color: var(--accent);
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .tip-box {
      background: #1e1b4b;
      border: 1px solid #4338ca;
      border-radius: 8px;
      padding: 0.85rem 1rem;
      font-size: 0.85rem;
      color: #c7d2fe;
      line-height: 1.5;
      margin-bottom: 1.25rem;
    }
    .tip-box a { color: #38bdf8; text-decoration: underline; font-weight: 600; }
    label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: #cbd5e1;
      margin-top: 0.85rem;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.65rem 0.8rem;
      margin-top: 0.3rem;
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: #fff;
      font-size: 0.9rem;
    }
    input:focus { outline: none; border-color: var(--accent); }
    .btn-primary {
      background: var(--accent);
      color: #0f172a;
      border: none;
      padding: 0.75rem 1.25rem;
      border-radius: 6px;
      font-weight: 700;
      font-size: 0.9rem;
      cursor: pointer;
      width: 100%;
      margin-top: 1.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-danger-sm {
      background: #450a0a;
      border: 1px solid #7f1d1d;
      color: #fca5a5;
      padding: 0.3rem 0.65rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-danger-sm:hover { background: #991b1b; color: #fff; }
    .alert-banner {
      display: none;
      padding: 0.75rem 1rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      font-size: 0.85rem;
    }
    .alert-banner.error { background: #450a0a; border: 1px solid #ef4444; color: #fca5a5; display: block; }
    .alert-banner.success { background: #064e3b; border: 1px solid #10b981; color: #6ee7b7; display: block; }
    .spinner {
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top: 2px solid #fff;
      width: 16px;
      height: 16px;
      animation: spin 0.8s linear infinite;
      display: none;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title-group">
        <h1><span>📬</span> Styx Email Hub</h1>
        <div class="subtitle">Multi-Account Mailbox Connector & Real-Time IMAP IDLE Push</div>
      </div>
      <div>
        <span class="badge-live">● Daemon Active (:8771)</span>
      </div>
    </div>

    <div id="statusAlert" class="alert-banner"></div>

    <div class="section-title">
      <span>Connected Mailboxes (${accounts.length})</span>
      <a href="http://localhost:3000" target="_blank" style="font-size:0.8rem; color:var(--accent); text-decoration:none;">Open Styx UI &rarr;</a>
    </div>

    <div class="accounts-grid" id="accountsList">
      ${accountCards}
    </div>

    <div class="section-title">
      <span>Connect a Mailbox</span>
    </div>

    <div class="card">
      <div class="tab-bar">
        <button class="tab-btn active" onclick="switchTab('tab-gmail')">Google Gmail (Direct 10s)</button>
        <button class="tab-btn" onclick="switchTab('tab-outlook')">Microsoft Outlook</button>
        <button class="tab-btn" onclick="switchTab('tab-icloud')">Apple iCloud / Custom</button>
        <button class="tab-btn" onclick="switchTab('tab-oauth')">Google Cloud OAuth</button>
      </div>

      <!-- Tab 1: Gmail App Password -->
      <div id="tab-gmail" class="tab-content active">
        <div class="tip-box">
          <strong>⚡ 2 Quick Steps for Gmail (Takes ~15 seconds):</strong><br>
          <strong>Step 1:</strong> In Gmail, verify IMAP is enabled: <a href="https://mail.google.com/mail/u/0/#settings/fwdandpop" target="_blank">Gmail Settings &rarr; Forwarding and POP/IMAP ↗</a> &bull; select <strong>Enable IMAP</strong> &bull; Save Changes.<br>
          <strong>Step 2:</strong> Open <a href="https://myaccount.google.com/apppasswords" target="_blank">Google App Passwords ↗</a>, create one named <code>Styx</code>, and paste the 16 letters below.
        </div>
        <form onsubmit="handleDirectSubmit(event, 'gmail')">
          <label>Mailbox Identifier / Alias</label>
          <input type="text" name="account" placeholder="personal" value="personal" required>
          <label>Gmail Address</label>
          <input type="email" name="user" placeholder="your_email@gmail.com" required>
          <label>Google 16-Character App Password</label>
          <input type="password" name="pass" placeholder="16 letters (e.g. abcd efgh ijkl mnop)" required>
          <button type="submit" class="btn-primary" id="btn-submit-gmail">
            <span class="spinner" id="spinner-gmail"></span>
            <span>Connect Gmail Mailbox</span>
          </button>
        </form>
      </div>

      <!-- Tab 2: Outlook -->
      <div id="tab-outlook" class="tab-content">
        <div class="tip-box">
          Connect your Microsoft Outlook, Hotmail, or Office 365 mailbox using your email and password or App Password.
        </div>
        <form onsubmit="handleDirectSubmit(event, 'outlook')">
          <label>Mailbox Identifier / Alias</label>
          <input type="text" name="account" placeholder="work" value="work" required>
          <label>Outlook / Office 365 Email</label>
          <input type="email" name="user" placeholder="name@outlook.com" required>
          <label>Password / App Password</label>
          <input type="password" name="pass" placeholder="Your password" required>
          <button type="submit" class="btn-primary" id="btn-submit-outlook">
            <span class="spinner" id="spinner-outlook"></span>
            <span>Connect Outlook Mailbox</span>
          </button>
        </form>
      </div>

      <!-- Tab 3: iCloud / Custom -->
      <div id="tab-icloud" class="tab-content">
        <div class="tip-box">
          For Apple iCloud, generate an App-Specific Password at <a href="https://appleid.apple.com" target="_blank">appleid.apple.com ↗</a>.
        </div>
        <form onsubmit="handleDirectSubmit(event, 'icloud')">
          <label>Mailbox Identifier</label>
          <input type="text" name="account" placeholder="icloud" value="icloud" required>
          <label>Email Address</label>
          <input type="email" name="user" placeholder="username@icloud.com" required>
          <label>App-Specific Password</label>
          <input type="password" name="pass" placeholder="xxxx-xxxx-xxxx-xxxx" required>
          <button type="submit" class="btn-primary" id="btn-submit-icloud">
            <span class="spinner" id="spinner-icloud"></span>
            <span>Connect iCloud Mailbox</span>
          </button>
        </form>
      </div>

      <!-- Tab 4: OAuth 2.0 -->
      <div id="tab-oauth" class="tab-content">
        <div class="tip-box">
          Use OAuth 2.0 PKCE if you have created a Google Cloud Project with OAuth Client credentials.
        </div>
        <a href="/auth/connect?provider=gmail" class="btn-primary" style="text-decoration:none;">
          Launch Google OAuth 2.0 Setup Flow &rarr;
        </a>
      </div>
    </div>
  </div>

  <script>
    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    }

    function showAlert(msg, isError) {
      const el = document.getElementById('statusAlert');
      el.className = 'alert-banner ' + (isError ? 'error' : 'success');
      el.innerText = msg;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function handleDirectSubmit(e, provider) {
      e.preventDefault();
      const form = e.target;
      const account = form.account.value.trim();
      const user = form.user.value.trim();
      const pass = form.pass.value.trim();

      const btn = form.querySelector('button[type="submit"]');
      const spinner = form.querySelector('.spinner');
      btn.disabled = true;
      if (spinner) spinner.style.display = 'inline-block';

      try {
        const res = await fetch('/accounts/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: account, provider, user, pass })
        });
        const data = await res.json();
        if (data.success) {
          showAlert('✓ Mailbox "' + account + '" connected successfully! Real-time IMAP IDLE is active.', false);
          setTimeout(() => window.location.reload(), 1200);
        } else {
          showAlert('❌ Connection failed: ' + (data.error || 'Check email and password'), true);
        }
      } catch (err) {
        showAlert('❌ Network error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        if (spinner) spinner.style.display = 'none';
      }
    }

    async function disconnectAccount(id) {
      if (!confirm('Disconnect mailbox "' + id + '"?')) return;
      try {
        const res = await fetch('/accounts/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.success) {
          showAlert('Mailbox "' + id + '" disconnected.', false);
          setTimeout(() => window.location.reload(), 800);
        } else {
          showAlert('Error: ' + data.error, true);
        }
      } catch (err) {
        showAlert('Network error: ' + err.message, true);
      }
    }
  </script>
</body>
</html>`;
}

export function renderOAuthConfigHtml({ provider, accountId, redirectUri }) {
  const isGmail = provider === 'gmail';
  const placeholder = isGmail ? '1234567890-abc123xyz.apps.googleusercontent.com' : 'Your OAuth Application (Client) ID';
  const consoleLink = isGmail
    ? 'https://console.cloud.google.com/apis/credentials'
    : 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connect ${provider.toUpperCase()} - Styx Agent OS</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2rem; max-width: 560px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
    h2 { margin-top: 0; color: #38bdf8; font-size: 1.4rem; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
    label { display: block; margin-top: 1rem; font-weight: 500; font-size: 0.85rem; color: #cbd5e1; }
    input { width: 100%; box-sizing: border-box; padding: 0.65rem; margin-top: 0.3rem; background: #0f172a; border: 1px solid #475569; border-radius: 6px; color: #fff; font-size: 0.9rem; }
    .btn { display: inline-block; margin-top: 1.5rem; width: 100%; box-sizing: border-box; background: #0284c7; color: #fff; border: none; padding: 0.75rem; border-radius: 6px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
    .btn:hover { background: #0369a1; }
    .code-box { background: #0f172a; padding: 0.5rem; border-radius: 4px; font-family: monospace; font-size: 0.82rem; word-break: break-all; color: #38bdf8; border: 1px solid #334155; }
    .alert-box { background: #1e1b4b; border: 1px solid #4338ca; border-radius: 8px; padding: 0.85rem; margin-top: 1rem; font-size: 0.85rem; color: #c7d2fe; line-height: 1.4; }
    .alert-warn { background: #451a03; border-color: #b45309; color: #fde68a; }
    .err-msg { display: none; color: #f87171; font-size: 0.85rem; margin-top: 0.5rem; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Connect ${isGmail ? 'Google Gmail' : 'Microsoft Outlook'} (OAuth 2.0)</h2>
    <p>To connect Styx using Modern Auth without storing static passwords, enter your OAuth App credentials from <a href="${consoleLink}" target="_blank" style="color:#38bdf8; text-decoration:underline;">${isGmail ? 'Google Cloud Console' : 'Azure Portal'} &nearr;</a></p>

    <div style="margin-bottom: 1rem;">
      <span style="font-size:0.8rem; color:#94a3b8; font-weight: 500;">1. Authorized Redirect URI (add to your OAuth Client in console):</span>
      <div class="code-box">${redirectUri}</div>
    </div>

    ${isGmail ? `
    <div class="alert-box alert-warn">
      <strong>⚠️ Important for Google OAuth:</strong><br>
      • Copy the <strong>OAuth 2.0 Client ID</strong> under "OAuth 2.0 Client IDs" (ends with <code>.apps.googleusercontent.com</code>).<br>
      • Do <strong>NOT</strong> paste your Project ID, Project Name, or API Key (<code>AIza...</code>).
    </div>
    ` : ''}

    <form method="GET" action="/auth/connect" id="oauthForm">
      <input type="hidden" name="provider" value="${provider}">
      <label>Account ID / Mailbox Label (e.g. personal, work, school)</label>
      <input type="text" name="account" value="${accountId}" required>

      <label>OAuth Client ID</label>
      <input type="text" id="clientIdInput" name="client_id" placeholder="${placeholder}" required>
      <div id="clientIdError" class="err-msg"></div>

      <label>Client Secret (Optional for PKCE public clients)</label>
      <input type="password" name="client_secret" placeholder="Your OAuth Client Secret">

      <button type="submit" class="btn">Continue to Provider Login &rarr;</button>
    </form>
  </div>

  <script>
    const form = document.getElementById('oauthForm');
    const input = document.getElementById('clientIdInput');
    const err = document.getElementById('clientIdError');
    const provider = "${provider}";

    form.addEventListener('submit', function(e) {
      const val = input.value.trim();
      if (provider === 'gmail' && !val.endsWith('.apps.googleusercontent.com')) {
        e.preventDefault();
        err.style.display = 'block';
        err.innerHTML = '❌ Invalid Google Client ID. It must end with <code>.apps.googleusercontent.com</code>.<br>Please copy the Client ID from <em>Google Cloud Console &rarr; APIs &amp; Services &rarr; Credentials &rarr; OAuth 2.0 Client IDs</em>, not the Project ID or API Key.';
      } else {
        err.style.display = 'none';
      }
    });
  </script>
</body>
</html>`;
}

export function renderOAuthSuccessHtml({ account, email, provider }) {
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
    <a href="/" class="btn">Go to Mailbox Hub</a>
  </div>
</body>
</html>`;
}

export function renderOAuthErrorHtml(errorMsg) {
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
    <a href="/" class="btn">Try Again</a>
  </div>
</body>
</html>`;
}

export default {
  renderMailboxDashboardHtml,
  renderOAuthConfigHtml,
  renderOAuthSuccessHtml,
  renderOAuthErrorHtml,
};
