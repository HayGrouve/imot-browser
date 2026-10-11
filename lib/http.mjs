// Polite HTTP client for imot.bg: global request spacing, bounded concurrency,
// retries with backoff, windows-1251 decoding and Cloudflare-block detection.

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export class BlockedError extends Error {
  constructor(status, url) {
    super(`imot.bg refused the request (HTTP ${status}) — likely rate limiting or a Cloudflare challenge`);
    this.code = 'blocked'; this.status = status; this.url = url;
  }
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.code = status === 404 ? 'notFound' : 'http'; this.status = status; this.url = url;
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
});

function decode(buf, contentType) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType || '')?.[1];
  const head = new TextDecoder('latin1').decode(buf.subarray(0, 2048));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const charset = (fromHeader || fromMeta || 'windows-1251').toLowerCase();
  try { return new TextDecoder(charset).decode(buf); } catch { return new TextDecoder('windows-1251').decode(buf); }
}

export class Fetcher {
  constructor({ minIntervalMs = 350, concurrency = 3, retries = 3, signal } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.concurrency = concurrency;
    this.retries = retries;
    this.signal = signal;
    this.active = 0;
    this.queue = [];
    this.nextStart = 0;
    this.requests = 0;
  }

  async #slot() {
    if (this.active >= this.concurrency) await new Promise((r) => this.queue.push(r));
    this.active++;
    const now = Date.now();
    const start = Math.max(now, this.nextStart);
    this.nextStart = start + this.minIntervalMs;
    if (start > now) await sleep(start - now, this.signal);
  }

  #release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  /** GET a page and return { status, html, url }. 404 resolves with status 404 (callers decide). */
  get(url) { return this.#request(url); }

  /**
   * POST url-encoded fields, same handling as get(). Encoded like imot.bg's own scripts (jQuery 3):
   * UTF-8 with spaces as %20. Its CGI does not decode "+" as a space (it answers "грешка е41").
   */
  post(url, fields) {
    return this.#request(url, {
      method: 'POST',
      payload: Object.entries(fields).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    });
  }

  async #request(url, { method = 'GET', payload, headers = {} } = {}) {
    let attempt = 0;
    for (;;) {
      this.signal?.throwIfAborted();
      await this.#slot();
      let res; let body;
      try {
        this.requests++;
        res = await fetch(url, {
          method,
          body: payload,
          signal: this.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'bg-BG,bg;q=0.9,en;q=0.8',
            ...headers,
          },
        });
        body = decode(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type'));
      } catch (err) {
        this.#release();
        if (this.signal?.aborted) throw err;
        if (++attempt > this.retries) throw err;
        await sleep(1500 * 2 ** (attempt - 1), this.signal);
        continue;
      }
      this.#release();

      const challenged = res.headers.get('cf-mitigated') === 'challenge'
        || /challenge-platform|cf-chl-|Just a moment\.\.\.|Attention Required!/i.test(body.slice(0, 5000));
      if (challenged) throw new BlockedError(res.status, url);
      if (res.status === 429 || res.status >= 500) {
        if (++attempt > this.retries) {
          if (res.status === 429) throw new BlockedError(res.status, url);
          throw new HttpError(res.status, url);
        }
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** (attempt - 1), this.signal);
        continue;
      }
      if (res.status === 403) throw new BlockedError(res.status, url);
      if (!res.ok && res.status !== 404) throw new HttpError(res.status, url);
      return { status: res.status, html: body, url: res.url };
    }
  }
}
