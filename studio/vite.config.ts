import { defineConfig } from "vite";

// The run server (server/app.py) answers /api/ for `npm run dev` and `npm run
// preview`. NLP_RUN_SERVER points at one somewhere other than its default address.
const RUN_SERVER = process.env.NLP_RUN_SERVER ?? "http://127.0.0.1:8765";

// A static site: relative asset paths, so dist/ works from any folder or host.
// The language server is not built here -- it is the committed
// public/language-server/browserServer.js (see SOURCE.md there).
export default defineConfig({
	base: "./",
	build: {
		target: "es2022",
		// Monaco's editor core is one large chunk by nature (~4 MB, ~1 MB gzipped).
		chunkSizeWarningLimit: 5000,
		// Two pages: the studio (Monaco, editing, GitHub) and try/, which reads and runs
		// the analyzers baked in by scripts/copy-analyzers.mjs and loads no editor at all.
		rollupOptions: {
			input: {
				studio: new URL("index.html", import.meta.url).pathname,
				try: new URL("try/index.html", import.meta.url).pathname,
			},
		},
	},
	worker: { format: "es" },
	// ../analyzer-views is linked, not copied, and has its own node_modules; one copy of
	// shiki serves it and @shikijs/monaco.
	resolve: { dedupe: ["@shikijs/core", "@shikijs/engine-javascript", "@shikijs/themes"] },
	server: { proxy: { "/api": RUN_SERVER } },
	preview: { proxy: { "/api": RUN_SERVER } },
});
