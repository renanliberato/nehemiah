import { describe, it, expect } from "vitest";
import { add, multiply, divide } from "../math.js";

describe("math", () => {
  it("adds two numbers", () => {
    expect(add(1, 2)).toBe(3);
  });

  it("multiplies two numbers", () => {
    expect(multiply(3, 4)).toBe(12);
  });

  it("divides two numbers", () => {
    expect(divide(10, 2)).toBe(5);
  });

  it("throws on division by zero", () => {
    expect(() => divide(5, 0)).toThrow("Division by zero");
  });
});
