import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { vi } from "vitest";
import { afterEach } from "vitest";

afterEach(() => cleanup());

const memory = new Map<string, string>();
const storage: Storage = {
  get length() {
    return memory.size;
  },
  clear: () => memory.clear(),
  getItem: (key) => memory.get(key) ?? null,
  key: (index) => [...memory.keys()][index] ?? null,
  removeItem: (key) => {
    memory.delete(key);
  },
  setItem: (key, value) => {
    memory.set(key, String(value));
  },
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: vi.fn(),
});
Object.defineProperty(HTMLMediaElement.prototype, "load", {
  configurable: true,
  value: vi.fn(),
});
Object.defineProperty(globalThis.URL, "createObjectURL", {
  configurable: true,
  value: vi.fn(() => "blob:preview"),
});
Object.defineProperty(globalThis.URL, "revokeObjectURL", {
  configurable: true,
  value: vi.fn(),
});
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});
