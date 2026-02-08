import { test, expect } from "bun:test";
import { ATTR_SOURCE, ATTR_COMPONENT } from "../src/types.js";

test("ATTR_SOURCE has correct value", () => {
  expect(ATTR_SOURCE).toBe("data-solid-source");
});

test("ATTR_COMPONENT has correct value", () => {
  expect(ATTR_COMPONENT).toBe("data-solid-component");
});
