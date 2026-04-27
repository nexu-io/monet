# External connectors manual QA runbook

This runbook covers the live-provider connector scenarios that cannot be fully proven by automated tests. It focuses on GitHub because it exercises OAuth, read tools, write-tool approval, credential revocation, disconnect cleanup, and chat-run cancellation in one connector.

## Prerequisites

1. Use a disposable GitHub account or sandbox organization/repository. Do not run write-tool checks against production repositories.
2. Configure Composio in Settings → Connectors with a provider API key and auth config IDs for the connectors under test.
3. Start the normal dev stack:

   ```bash
   pnpm dev
   ```

4. Open the app and confirm the `Connectors` sidebar item is visible.
5. Ensure the local data directory is either fresh or already has no connected GitHub account. If a GitHub account is already connected, disconnect it before starting.
6. Keep these inspection tools available:
   - browser/devtools network panel for local connector API status responses
   - controller logs for safe metadata-only logging checks
   - GitHub OAuth application settings for revoking the connection during the revoked-credential scenario

## Pass/fail record

For each scenario, record:

- date, build/commit, OS, and app mode
- connector provider configuration source used, without copying secrets
- GitHub test account and sandbox repository name, if applicable
- expected result, actual result, and pass/fail
- any controller log lines reviewed, with secrets and personal data redacted before sharing

The manual QA pass is complete only when every required scenario below passes or has a documented product/infra blocker.

## Required scenarios

### 1. Connect GitHub through OAuth

1. Navigate to `/connectors`.
2. Verify the GitHub card is present and shows a not-connected state with a `Connect` action.
3. Click `Connect`.
4. Verify the provider authorization URL opens in the external browser flow, not inside an unsafe embedded renderer.
5. Complete GitHub authorization with the disposable account.
6. Return to the app through the configured callback/redirect path.

Expected result:

- The app returns safely to `/connectors`.
- GitHub refreshes to `connected` without exposing OAuth codes or provider tokens in UI text, URLs shown in-app, or logs.
- The detail drawer shows an account label and only curated allowlisted GitHub tools.

### 2. Run a read-only GitHub connector tool

1. Start a new chat.
2. Ask the agent to perform a read-only GitHub action, for example: `Use GitHub to list open issues in <sandbox-owner>/<sandbox-repo>. Do not create or modify anything.`
3. Allow the run to complete.

Expected result:

- The agent can discover and execute only the prefixed, curated GitHub tool.
- The tool-call UI identifies the connector, connected account label, and tool name.
- No write approval is requested for a read-only action unless the configured read policy intentionally requires first-use approval.
- Tool-call persistence and logs include safe metadata such as connector ID, tool name, duration, status, normalized error code, and provider execution ID when available; they do not include raw arguments, raw results, OAuth codes, tokens, provider API keys, or authorization headers.

### 3. Require approval for a GitHub write tool

1. In chat, ask the agent to create a low-risk test issue in the sandbox repository, for example: `Create a GitHub issue in <sandbox-owner>/<sandbox-repo> titled "Connector QA test - safe to delete" with body "Manual QA write approval check."`
2. Stop before approving and inspect the pending approval card.
3. Reject once and verify no issue is created.
4. Repeat the request, approve the pending connector tool call, and let it complete.

Expected result:

- The pending approval card clearly shows GitHub, the account label, the tool name, summarized arguments, and the write approval policy.
- Rejecting prevents provider execution and leaves no GitHub issue behind.
- Approving executes the provider call once and creates exactly one issue in the sandbox repository.
- Logs and persisted tool-call metadata stay redacted and contain no raw auth headers, provider secrets, or OAuth tokens.

### 4. Handle revoked or expired GitHub credentials

1. With GitHub connected, revoke the app/Composio authorization from GitHub account settings or otherwise invalidate the provider-side credential.
2. Return to the app and refresh `/connectors`.
3. Open the GitHub detail drawer and start a chat that attempts a GitHub read action.

Expected result:

- GitHub transitions to an expired/reconnect state after status refresh or failed provider verification.
- The primary action changes to `Reconnect`.
- Runtime tool execution fails closed with a normalized `connection_expired` or equivalent connection error, not a raw provider error payload.
- The UI shows a generic safe error and does not expose provider tokens, OAuth codes, raw authorization headers, or raw provider responses.

### 5. Disconnect GitHub and remove runtime tools

1. Reconnect GitHub if the previous scenario left it expired.
2. Open the GitHub detail drawer from `/connectors`.
3. Click `Disconnect` and confirm.
4. Refresh `/connectors` and start a new chat that asks for a GitHub action.

Expected result:

- The local connection is marked disconnected and provider revocation is attempted when supported.
- GitHub returns to the not-connected state with `Connect` as the primary action.
- GitHub connector tools are removed from future chat runtime composition.
- Pending approvals for GitHub are cancelled or prevented from late execution.
- Asking for a GitHub action after disconnect either explains that GitHub is not connected or fails with a normalized `connection_missing` error; it must not execute a provider call.

### 6. Abort in-flight connector execution

1. Connect GitHub.
2. Start a chat request likely to invoke a long-running GitHub connector action, such as searching a broad issue/PR query in the sandbox organization.
3. As soon as the connector tool call enters a running/preparing state, cancel or stop the chat run.
4. Wait for the UI and controller logs to settle.

Expected result:

- The chat run cancellation propagates an `AbortSignal` into connector execution where the provider SDK/API supports cancellation.
- The tool-call UI moves to a cancelled/failed-safe terminal state and does not later append a successful connector result.
- No late provider execution occurs after cancellation approval state changes.
- Logs include only safe cancellation metadata and no raw arguments, raw results, OAuth codes, tokens, provider API keys, or authorization headers.

## Cleanup

1. Delete any sandbox GitHub issues created during the write-tool scenario.
2. Disconnect GitHub from the app.
3. Revoke the test OAuth/app authorization from GitHub or the provider dashboard if still present.
4. Remove any temporary local provider configuration used only for QA.
