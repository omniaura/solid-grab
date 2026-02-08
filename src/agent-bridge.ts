/**
 * agent-bridge.ts
 *
 * Optional WebSocket bridge for sending grabbed context directly to
 * coding agents (Claude Code, Cursor, etc).
 *
 * The bridge runs a WebSocket client that connects to a local server.
 * The server is expected to be started alongside the dev server, similar
 * to how react-grab runs @react-grab/claude-code.
 */

import type { GrabbedContext } from "./types.js";

export class AgentBridge {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  constructor(url: string) {
    this.url = url;
  }

  get connected() {
    return this._connected;
  }

  connect() {
    if (this.ws) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this._connected = true;
        console.log("[solid-grab] Agent bridge connected:", this.url);
      };

      this.ws.onclose = () => {
        this._connected = false;
        this.ws = null;
        // Auto-reconnect after 3s
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = () => {
        // Silently handle — the onclose handler will trigger reconnect
        this.ws?.close();
      };
    } catch {
      // WebSocket constructor can throw if URL is invalid
      console.warn("[solid-grab] Invalid agent bridge URL:", this.url);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  send(context: GrabbedContext) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: "solid-grab:context",
        payload: {
          tagName: context.tagName,
          elementSource: context.elementSource,
          components: context.components,
          formatted: context.formatted,
          timestamp: context.timestamp,
        },
      })
    );
  }
}
