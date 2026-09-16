import { defineConfig } from "vitest/config";

// The elements need a DOM; the rules do not, and their tests say so.
export default defineConfig({
	test: { environment: "happy-dom" },
});
