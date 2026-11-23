// Ask anything opens websites the user asks for. The address comes from a model that may have read
// untrusted selected text, so only plain web addresses are ever opened: other schemes (file:,
// ms-settings:, search-ms:, an app's own protocol) can run things on the computer.

/** The address as a web page to open, or undefined when it is not an http or https address. */
export function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    // "https://google.com@evil.example" shows one site and opens another.
    if (url.username || url.password || !url.hostname.includes('.')) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
