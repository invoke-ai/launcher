/**
 * Shared URL helpers used by both the renderer (input validation, review display) and the main process (defense-in-depth
 * re-validation, credential handling and log redaction). Kept here so both sides apply exactly the same rules.
 */

/**
 * Whether a string parses as an http(s) URL.
 */
const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * A custom torch index URL is optional. When set, it must be a valid http(s) URL. Anything else (typos like
 * `htps://...`, a bare `cu126`, etc.) is rejected so it doesn't surface minutes into an install as a cryptic uv
 * resolver error.
 */
export const isCustomTorchIndexUrlInvalid = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.length > 0 && !isHttpUrl(trimmed);
};

/**
 * Matches the `user:pass@` userinfo section of a URL-ish string, with or without a scheme.
 *
 * We deliberately do not use the WHATWG `URL` parser for redaction. A scheme-less value like `user:token@host/simple`
 * parses `user:` as the *scheme*, so `url.username`/`url.password` come back empty and the credentials would survive
 * untouched - and that is exactly the shape that reaches the invalid-URL error path, which logs the value. The same
 * goes for anything else `new URL()` throws on (e.g. an out-of-range port).
 *
 * The userinfo group is greedy so it backtracks to the *last* `@` before the first path separator, which keeps
 * passwords containing an unencoded `@` from leaking.
 */
const USERINFO_PATTERN = /^((?:[a-zA-Z][a-zA-Z0-9+.-]*:)?\/\/)?([^/?#\s]+)@/;

/**
 * Redact any embedded credentials (`https://user:pass@host/...`) from a URL before it is written to the install log or
 * rendered in the UI. Returns the input unchanged if it carries no credentials.
 */
export const redactUrlCredentials = (value: string): string => {
  return value.replace(USERINFO_PATTERN, (_match, scheme: string | undefined, userinfo: string) => {
    const redacted = userinfo.includes(':') ? '***:***' : '***';
    return `${scheme ?? ''}${redacted}@`;
  });
};

type IndexUrlCredentials = {
  /** The URL with any userinfo removed, safe to pass as a command-line argument. */
  url: string;
  username?: string;
  password?: string;
};

/**
 * Split any embedded credentials out of an index URL.
 *
 * Command-line arguments are world-readable while the process runs (`ps auxww`, `/proc/<pid>/cmdline`, Task Manager),
 * and a torch download is a multi-GB, multi-minute process. uv can take index credentials from the environment
 * instead (`UV_INDEX_<NAME>_USERNAME` / `_PASSWORD`), so we strip them from the URL and pass them that way.
 *
 * Only meaningful for values that have already passed {@link isCustomTorchIndexUrlInvalid}; anything the URL parser
 * rejects is returned unchanged.
 */
export const splitIndexUrlCredentials = (value: string): IndexUrlCredentials => {
  try {
    const url = new URL(value);
    if (!url.username && !url.password) {
      return { url: value };
    }
    // Userinfo is percent-encoded in the URL; uv expects the decoded values in the environment.
    const username = url.username ? decodeURIComponent(url.username) : undefined;
    const password = url.password ? decodeURIComponent(url.password) : undefined;
    url.username = '';
    url.password = '';
    return { url: url.toString(), username, password };
  } catch {
    return { url: value };
  }
};

/**
 * Whether a URL sends credentials in cleartext over the wire (`http://user:pass@...`). Worth a warning - the user may
 * not realise their token is not protected by TLS.
 */
export const hasInsecureCredentials = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && Boolean(url.username || url.password);
  } catch {
    return false;
  }
};
