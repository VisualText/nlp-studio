import { defineConfig } from "vite";

// A static site: relative asset paths, so dist/ works from any folder or host.
// The language server is not built here -- it is the committed
// public/language-server/browserServer.js (see SOURCE.md there).
export default defineConfig({
	base: "./",
	build: {
		target: "es2022",
		// Monaco's editor core is one large chunk by nature (~4 MB, ~1 MB gzipped).
		chunkSizeWarningLimit: 5000,
	},
	worker: { format: "es" },
});
