import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Helper to pause execution for politeness rate-limiting.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a safe filename from a URL for the cache.
 */
function urlToCacheFilename(url) {
  const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
  const sanitized = url.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
  return `${sanitized}_${hash}.html`;
}

/**
 * Polite HTTP Fetcher with Disk Caching.
 * 
 * Rules:
 * 1. Honest User-Agent identifying the project and author.
 * 2. Strict timeout (default 5 seconds).
 * 3. Status 200 check before anything else.
 * 4. Disk caching in cache/ directory to save bandwidth and prevent hammering servers.
 * 5. Minimum 500ms delay between live network requests (0 delay on cache hit).
 */
export class PoliteFetcher {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || config.cacheDir;
    this.userAgent = options.userAgent || config.scraperUserAgent;
    this.timeoutMs = options.timeoutMs || config.scraperTimeoutMs;
    this.delayMs = options.delayMs || config.scraperRequestDelayMs;
    this.lastRequestTimes = new Map();
    this.cacheHits = 0;
    this.liveFetches = 0;
  }

  get lastRequestTime() {
    let max = 0;
    for (const time of this.lastRequestTimes.values()) {
      if (time > max) max = time;
    }
    return max;
  }

  set lastRequestTime(time) {
    this.lastRequestTimes.set("default", time);
  }

  async init() {
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  async fetch(url, options = {}) {
    await this.init();
    const cacheFile = path.join(this.cacheDir, urlToCacheFilename(url));

    // 1. Check local cache first (Cache-aside pattern)
    if (!options.bypassCache) {
      try {
        const cachedHtml = await fs.readFile(cacheFile, "utf-8");
        this.cacheHits++;
        const sizeBytes = Buffer.byteLength(cachedHtml, "utf-8");
        console.log(`[CACHE HIT] ${url} (${sizeBytes} bytes)`);
        return {
          url,
          status: 200,
          html: cachedHtml,
          isCacheHit: true,
          sizeBytes
        };
      } catch (err) {
        // Cache miss, proceed to network request
      }
    }

    // 2. Enforce politeness delay between real network requests (per hostname)
    let hostname = "default";
    try {
      hostname = new URL(url).hostname;
    } catch (e) {
      hostname = "default";
    }

    const now = Date.now();
    const lastHostTime = this.lastRequestTimes.get(hostname) || 0;
    const elapsedSinceLastReq = now - lastHostTime;
    if (elapsedSinceLastReq < this.delayMs) {
      await sleep(this.delayMs - elapsedSinceLastReq);
    }

    // 3. Make real polite network fetch
    this.lastRequestTimes.set(hostname, Date.now());
    this.liveFetches++;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": this.userAgent,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (response.status !== 200) {
        throw new Error(`HTTP fetch failed with status ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const sizeBytes = Buffer.byteLength(html, "utf-8");

      // 4. Save to cache
      await fs.writeFile(cacheFile, html, "utf-8");
      console.log(`[FETCH] ${url} (Status 200, ${sizeBytes} bytes)`);

      return {
        url,
        status: 200,
        html,
        isCacheHit: false,
        sizeBytes
      };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new Error(`Request timed out after ${this.timeoutMs}ms for ${url}`);
      }
      throw err;
    }
  }
}
