import { afterEach, describe, expect, it, vi } from "vitest";

import { listConnectors } from "./connectors-api";

vi.mock("./monet-client", () => ({
  getMonetClientConfig: () => ({ apiBase: "http://127.0.0.1:42831", bearerToken: "test-token", source: "default" })
}));

describe("connectors-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("deduplicates concurrent connector list requests", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ connectors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const [first, second, third] = await Promise.all([listConnectors(), listConnectors(), listConnectors()]);

    expect(first).toEqual({ connectors: [] });
    expect(second).toEqual({ connectors: [] });
    expect(third).toEqual({ connectors: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
