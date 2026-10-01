import crypto from 'crypto';
import logger from '../utils/logger.js';

export const OAUTH_PROVIDERS = {
  gmail: {
    name: 'Google Gmail',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: [
      'https://mail.google.com/',
      'email',
      'profile',
    ],
    defaultImapHost: 'imap.gmail.com',
    defaultImapPort: 993,
    defaultSmtpHost: 'smtp.gmail.com',
    defaultSmtpPort: 465,
  },
  outlook: {
    name: 'Microsoft Outlook / Office 365',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: [
      'https://outlook.office.com/IMAP.AccessAsUser.All',
      'https://outlook.office.com/SMTP.Send',
      'offline_access',
      'email',
      'profile',
      'User.Read',
    ],
    defaultImapHost: 'outlook.office365.com',
    defaultImapPort: 993,
    defaultSmtpHost: 'smtp.office365.com',
    defaultSmtpPort: 587,
  },
};

/**
 * Base64URL encoding without padding
 */
function base64UrlEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generates a PKCE code verifier and code challenge pair
 */
export function generatePkcePair() {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Generates OAuth2 authorization URL for user browser consent
 */
export function generateAuthUrl({ provider = 'gmail', accountId, clientId, redirectUri, state, codeChallenge }) {
  const prov = OAUTH_PROVIDERS[provider.toLowerCase()];
  if (!prov) {
    throw new Error(`Unsupported OAuth provider: ${provider}. Supported: gmail, outlook`);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: prov.scopes.join(' '),
    state: state || accountId || 'default',
    access_type: 'offline',
    prompt: 'consent',
  });

  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }

  return `${prov.authUrl}?${params.toString()}`;
}

/**
 * Exchanges authorization code for access_token and refresh_token
 */
export async function exchangeCodeForTokens({ provider = 'gmail', code, clientId, clientSecret, redirectUri, codeVerifier }) {
  const prov = OAUTH_PROVIDERS[provider.toLowerCase()];
  if (!prov) throw new Error(`Unsupported OAuth provider: ${provider}`);

  const bodyParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  if (clientSecret) {
    bodyParams.set('client_secret', clientSecret);
  }
  if (codeVerifier) {
    bodyParams.set('code_verifier', codeVerifier);
  }

  const res = await fetch(prov.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    logger.error({ status: res.status, data }, 'Failed to exchange OAuth code for tokens');
    throw new Error(data.error_description || data.error || 'Failed to exchange authorization code');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in,
    tokenType: data.token_type || 'Bearer',
    scope: data.scope,
    obtainedAt: Date.now(),
  };
}

/**
 * Refreshes an expired access token using the stored refresh_token
 */
export async function refreshAccessToken({ provider = 'gmail', refreshToken, clientId, clientSecret }) {
  const prov = OAUTH_PROVIDERS[provider.toLowerCase()];
  if (!prov) throw new Error(`Unsupported OAuth provider: ${provider}`);

  const bodyParams = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  if (clientSecret) {
    bodyParams.set('client_secret', clientSecret);
  }

  const res = await fetch(prov.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    logger.error({ status: res.status, data }, 'Failed to refresh OAuth token');
    throw new Error(data.error_description || data.error || 'Failed to refresh access token');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken, // some providers rotate refresh tokens
    expiresIn: data.expires_in,
    obtainedAt: Date.now(),
  };
}

/**
 * Fetches user email and profile from OAuth provider
 */
export async function fetchUserProfile({ provider = 'gmail', accessToken }) {
  const prov = OAUTH_PROVIDERS[provider.toLowerCase()];
  if (!prov) throw new Error(`Unsupported OAuth provider: ${provider}`);

  const res = await fetch(prov.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) {
    logger.warn({ status: res.status, data }, 'Failed to fetch user profile via OAuth');
    return null;
  }

  const email = data.email || data.userPrincipalName || data.mail;
  const name = data.name || data.displayName || email;

  return { email, name, raw: data };
}

export default {
  OAUTH_PROVIDERS,
  generatePkcePair,
  generateAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchUserProfile,
};
