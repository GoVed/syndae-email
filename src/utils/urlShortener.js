import config from '../config.js';

/**
 * Determines whether a URL is considered long, promotional, or tracking-heavy.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isPromotionalOrLong(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.length > 55) return true;
  if (
    url.length > 35 &&
    /(?:utm_|click|trk|track|token|redirect|affiliate|subscriber|session|auth_token|mc_cid|mc_eid|fbclid|gclid|wickedid)/i.test(url)
  ) {
    return true;
  }
  return false;
}

/**
 * Extracts a clean domain from a URL.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function getDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
}

/**
 * Generates a concise, informative human/LLM label from a URL.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function getShortLabel(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/$/, '');
    if (
      path &&
      path.length > 1 &&
      path.length < 24 &&
      !/[0-9a-f]{8,}/i.test(path) &&
      !/^\/(?:trk|click|track|u\/n)/i.test(path)
    ) {
      return host + path;
    }
    return host;
  } catch {
    return 'link';
  }
}

/**
 * Shortens promotional and tracking URLs within email text.
 * Preserves normal, clean, short URLs while compressing bloated marketing tokens.
 *
 * @param {string} text - Raw or parsed email text
 * @param {object} options
 * @param {string} options.account - Account ID (e.g. 'primary', 'work')
 * @param {number|string} options.uid - Email UID
 * @param {string} [options.baseUrl] - Base HTTP redirect resolver URL
 * @returns {{ text: string, links: Record<string, string>, count: number, summary: Array<{ id: string, label: string, domain: string, short_url: string }> }}
 */
export function shortenEmailLinks(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return { text: text || '', links: {}, count: 0, summary: [] };
  }

  const account = options.account || 'primary';
  const uid = options.uid !== undefined && options.uid !== null ? options.uid : 0;
  const baseUrl = options.baseUrl !== undefined
    ? options.baseUrl
    : (config.publicUrl ? `${config.publicUrl}/links` : `http://localhost:${config.httpPort || 8771}/links`);

  const links = {};
  const urlToId = {};
  const labels = {};
  const domains = {};
  let count = 0;

  function getOrAssignId(url) {
    if (urlToId[url]) {
      return urlToId[url];
    }
    count++;
    const id = String(count);
    urlToId[url] = id;
    links[id] = url;
    labels[id] = getShortLabel(url);
    domains[id] = getDomain(url);
    return id;
  }

  // 1. Markdown links: [label](url)
  const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
  let processed = text.replace(mdLinkRegex, (match, label, url) => {
    if (!isPromotionalOrLong(url)) return match;
    const id = getOrAssignId(url);
    const shortLabel = labels[id];
    const redirectUrl = baseUrl ? `${baseUrl}/${account}/${uid}/${id}` : url;
    const cleanLabel = (label.trim() === url.trim() || label.length > 40)
      ? shortLabel
      : `${label} (${shortLabel})`;
    return `[Link #${id}: ${cleanLabel}](${redirectUrl})`;
  });

  // 2. Bracketed URLs: [url] or <url>
  const bracketRegex = /[<\[](https?:\/\/[^\s>\]]+)[>\]]/g;
  processed = processed.replace(bracketRegex, (match, url) => {
    if (!isPromotionalOrLong(url)) return match;
    const id = getOrAssignId(url);
    const shortLabel = labels[id];
    const redirectUrl = baseUrl ? `${baseUrl}/${account}/${uid}/${id}` : url;
    return `[Link #${id}: ${shortLabel}](${redirectUrl})`;
  });

  // 3. Bare URLs
  const bareUrlRegex = /(https?:\/\/[^\s<>"'()]+[^\s<>"'().,!?:;])/g;
  processed = processed.replace(bareUrlRegex, (url) => {
    if (!isPromotionalOrLong(url)) return url;
    const id = getOrAssignId(url);
    const shortLabel = labels[id];
    const redirectUrl = baseUrl ? `${baseUrl}/${account}/${uid}/${id}` : url;
    return `[Link #${id}: ${shortLabel}](${redirectUrl})`;
  });

  const summary = Object.keys(links).map(id => ({
    id,
    label: labels[id],
    domain: domains[id],
    short_url: baseUrl ? `${baseUrl}/${account}/${uid}/${id}` : null,
  }));

  return { text: processed, links, count, summary };
}

export default {
  isPromotionalOrLong,
  getDomain,
  getShortLabel,
  shortenEmailLinks,
};
