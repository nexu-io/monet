"use client";

import { Button } from "@nexu-design/ui-web";

export function Composer() {
  return (
    <form className="composer" aria-label="Chat composer" onSubmit={(event) => event.preventDefault()}>
      <label className="sr-only" htmlFor="chat-composer-input">
        Message
      </label>
      <textarea
        id="chat-composer-input"
        className="composer-input"
        rows={4}
        placeholder="Ask Monet to inspect the local app, wire providers, or continue the current implementation loop..."
        defaultValue=""
      />

      <div className="composer-footer">
        <div className="composer-hints">
          <span>Enter for newline</span>
          <span>Cmd+Enter will send in a later iteration</span>
        </div>

        <div className="composer-actions">
          <Button type="button" variant="secondary">Attach context</Button>
          <Button type="submit" variant="primary">Send</Button>
        </div>
      </div>
    </form>
  );
}
