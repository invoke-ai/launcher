/**
 * Shared URL helpers used by both the renderer (input validation) and the main process (defense-in-depth
 * re-validation and log redaction). Kept here so both sides apply exactly the same rules.
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
 * Redact any embedded credentials (`https://user:pass@host/...`) from a URL before it is written to the install log.
 * Returns the input unchanged if it doesn't parse or carries no credentials.
 */
export const redactUrlCredentials = (value: string): string => {
  try {
    const url = new URL(value);
    if (!url.username && !url.password) {
      return value;
    }
    if (url.username) {
      url.username = '***';
    }
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return value;
  }
};
