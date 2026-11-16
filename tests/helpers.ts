import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FetchLike } from "@/lib/music/http";

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as T;
}

type Responder = (url: URL, init?: RequestInit) => Response | Promise<Response>;

/** A fake fetch that records every call. Throws on any URL no route matches (no live calls). */
export function fakeFetch(routes: Array<[match: RegExp | string, respond: Responder]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl: FetchLike = async (input, init) => {
    calls.push({ url: input, init });
    const url = new URL(input);
    for (const [match, respond] of routes) {
      const hit = typeof match === "string" ? input.includes(match) : match.test(input);
      if (hit) return respond(url, init);
    }
    throw new Error(`fakeFetch: unexpected request ${input}`);
  };
  return { fetch: impl, calls };
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

/** A sleep that records requested delays instead of waiting. */
export function recordingSleep() {
  const delays: number[] = [];
  return { sleep: async (ms: number) => void delays.push(ms), delays };
}
