import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedMainWindowNavigation, shouldOpenNavigationExternally } from "./navigation";

test("allows packaged renderer navigation inside the desktop protocol origin", () => {
  assert.equal(isAllowedMainWindowNavigation("app://monet/settings"), true);
});

test("allows dev renderer navigation only for the same origin", () => {
  assert.equal(
    isAllowedMainWindowNavigation("http://127.0.0.1:3000/settings?tab=general", "http://127.0.0.1:3000"),
    true
  );
  assert.equal(
    isAllowedMainWindowNavigation("http://127.0.0.1:3000.evil.tld/settings", "http://127.0.0.1:3000"),
    false
  );
});

test("allows dev renderer navigation only inside the configured pathname scope", () => {
  assert.equal(
    isAllowedMainWindowNavigation("http://127.0.0.1:3000/app/settings", "http://127.0.0.1:3000/app"),
    true
  );
  assert.equal(
    isAllowedMainWindowNavigation("http://127.0.0.1:3000/application", "http://127.0.0.1:3000/app"),
    false
  );
});

test("blocks file navigation from being opened externally", () => {
  assert.equal(isAllowedMainWindowNavigation("file:///tmp/attack.html"), false);
  assert.equal(shouldOpenNavigationExternally("file:///tmp/attack.html"), false);
  assert.equal(shouldOpenNavigationExternally("https://example.com"), true);
});
