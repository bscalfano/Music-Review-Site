export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
/** Resolves when the caller may make its next request (rate limiting). */
export type Throttle = () => Promise<void>;
export type Sleep = (ms: number) => Promise<void>;

export const noThrottle: Throttle = async () => {};
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

export type RequestOptions = {
  fetchImpl?: FetchLike;
  headers?: Record<string, string>;
  throttle?: Throttle;
  sleep?: Sleep;
  /** Retries after the first attempt, for 429/502/503/504 and network errors. */
  retries?: number;
  timeoutMs?: number;
};

const RETRYABLE = new Set([429, 502, 503, 504]);

async function request(url: string, opts: RequestOptions): Promise<Response> {
  const {
    fetchImpl = fetch as FetchLike,
    headers,
    throttle = noThrottle,
    sleep = realSleep,
    retries = 3,
    timeoutMs = 15_000,
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    try {
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      if (!RETRYABLE.has(res.status)) throw new HttpError(res.status, url);
      lastError = new HttpError(res.status, url);
      const retryAfter = Number(res.headers.get("retry-after"));
      if (attempt < retries) {
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt),
        );
      }
    } catch (err) {
      if (err instanceof HttpError) throw err; // non-retryable HTTP status
      lastError = err; // network error or timeout
      if (attempt < retries) await sleep(backoff(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}

const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);

export async function requestJson<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request(url, {
    ...opts,
    headers: { Accept: "application/json", ...opts.headers },
  });
  return (await res.json()) as T;
}

export async function requestBytes(
  url: string,
  opts: RequestOptions = {},
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await request(url, opts);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}
