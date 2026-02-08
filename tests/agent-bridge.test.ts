import { test, expect, describe } from "bun:test";
import { AgentBridge } from "../src/agent-bridge.js";

describe("AgentBridge", () => {
  test("starts disconnected", () => {
    const bridge = new AgentBridge("ws://localhost:9999");
    expect(bridge.connected).toBe(false);
  });

  test("disconnect is safe when not connected", () => {
    const bridge = new AgentBridge("ws://localhost:9999");
    // Should not throw
    bridge.disconnect();
    expect(bridge.connected).toBe(false);
  });

  test("send is a no-op when not connected", () => {
    const bridge = new AgentBridge("ws://localhost:9999");
    // Should not throw
    bridge.send({
      element: document.createElement("div"),
      tagName: "div",
      elementSource: null,
      components: [],
      formatted: "test",
      timestamp: Date.now(),
    });
    expect(bridge.connected).toBe(false);
  });

  test("disconnect after disconnect is safe", () => {
    const bridge = new AgentBridge("ws://localhost:9999");
    bridge.disconnect();
    bridge.disconnect();
    expect(bridge.connected).toBe(false);
  });
});
