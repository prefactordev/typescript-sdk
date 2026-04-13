import { describe, it, expect } from "bun:test";
import { add } from "./add";

describe("add", () => {
  it("should add two positive numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("should add negative numbers", () => {
    expect(add(-1, -1)).toBe(-2);
  });

  it("should add zero", () => {
    expect(add(0, 5)).toBe(5);
  });
});
