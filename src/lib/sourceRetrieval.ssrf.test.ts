import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isPrivateAddress,
  isPrivateHost,
  validateRetrievalUrl,
  retrieveSource,
  assertPublicDns,
  SsrfBlockedError,
} from "./sourceRetrieval";

// The retrieval module resolves hostnames via node:dns/promises. Stub it so
// tests are offline-deterministic: every lookup returns a public address and
// only the explicit literal checks refuse hosts.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

describe("isPrivateAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["192.168.1.1", true],
    ["169.254.169.254", true], // cloud metadata endpoint
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["0.0.0.0", true],
    ["100.64.0.1", true], // CGNAT
    ["198.18.0.1", true], // benchmarking
    ["224.0.0.1", true], // multicast
    ["255.255.255.255", true],
    ["256.1.1.1", true], // malformed → hostile
    ["8.8.8.8", false],
    ["172.32.0.1", false], // outside 172.16/12
    ["100.128.0.1", false], // outside CGNAT range
    ["1.1.1.1", false],
    ["::1", true],
    ["::", true],
    ["fd00::1", true], // unique local
    ["fe80::1", true], // link-local
    ["febf::1", true], // link-local upper bound
    ["fec0::1", false], // site-local (deprecated) — not blocked by numeric test
    ["::ffff:127.0.0.1", true], // IPv4-mapped loopback
    ["::ffff:169.254.169.254", true], // IPv4-mapped metadata
    ["2001:db8::1", false],
  ])("%s → %s", (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });
});

describe("isPrivateHost", () => {
  it.each([
    ["localhost", true],
    ["foo.local", true],
    ["svc.internal", true],
    ["metadata.google.internal", true],
    ["127.0.0.1", true],
    ["[::1]", true],
    ["EXAMPLE.COM", false],
    ["example.com", false],
    ["sub.example.com", false],
  ])("%s → %s", (host, expected) => {
    expect(isPrivateHost(host)).toBe(expected);
  });
});

describe("validateRetrievalUrl", () => {
  it("rejects non-https, credential-embedding, oversized, and private-literal URLs", () => {
    expect(validateRetrievalUrl("http://example.com/a").ok).toBe(false);
    expect(validateRetrievalUrl("https://user:pass@example.com/a").ok).toBe(false);
    expect(validateRetrievalUrl(`https://example.com/${"a".repeat(700)}`).ok).toBe(false);
    expect(validateRetrievalUrl("https://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(validateRetrievalUrl("https://localhost/admin").ok).toBe(false);
    expect(validateRetrievalUrl("https://10.0.0.1/internal").ok).toBe(false);
    expect(validateRetrievalUrl("https://192.168.0.1/router").ok).toBe(false);
    expect(validateRetrievalUrl("not a url").ok).toBe(false);
  });

  it("accepts normal public https URLs", () => {
    expect(validateRetrievalUrl("https://www.reuters.com/article/x").ok).toBe(true);
  });
});

describe("assertPublicDns", () => {
  it("rejects forbidden host literals without a DNS round-trip", async () => {
    await expect(assertPublicDns("localhost")).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicDns("metadata.google.internal")).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe("retrieveSource SSRF behaviour", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails fast on private and metadata literals before any fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const meta = await retrieveSource("https://169.254.169.254/latest/meta-data/");
    expect(meta.sourceStatus).toBe("failed");
    expect(meta.failureStatus).toBe("invalid_url");
    expect(fetchSpy).not.toHaveBeenCalled();

    const loopback = await retrieveSource("https://127.0.0.1:8080/admin");
    expect(loopback.sourceStatus).toBe("failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("revalidates redirect hops and refuses a redirect into a private address", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data/" } }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await retrieveSource("https://evil.example.com/start");
    expect(result.sourceStatus).toBe("failed");
    expect(result.failureStatus).toBe("invalid_url");
    expect(result.failureDetails).toContain("private");
    // Exactly one outbound request: the second hop is refused before fetching.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect downgrading to http", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 301, headers: { location: "http://example.com/plain" } })),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await retrieveSource("https://evil.example.com/start");
    expect(result.sourceStatus).toBe("failed");
    expect(result.failureStatus).toBe("not_https");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("aborts streaming once the byte cap is exceeded instead of buffering the body", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(0x61);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 100; i++) controller.enqueue(chunk);
        // never closed: a hostile unbounded body
      },
    });
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(stream, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await retrieveSource("https://example.com/huge", { maxBytes: 100_000 });
    expect(result.sourceStatus).toBe("failed");
    expect(result.failureStatus).toBe("too_large");
  });

  it("still retrieves a normal page through the streaming path", async () => {
    const html = "<html><head><title>Ok</title></head><body>hello world</body></html>";
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await retrieveSource("https://example.com/normal");
    expect(result.sourceStatus).toBe("retrieved");
    expect(result.title).toBe("Ok");
    expect(result.snippet).toContain("hello world");
  });
});
