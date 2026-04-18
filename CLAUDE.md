# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (watch mode, outputs to project root)
npm run dev

# Development (watch mode, copies directly into vault)
npm run dev:vault

# Production build (outputs to project root)
npm run build

# Production build + copy into vault
npm run build:vault
```

The vault path is hardcoded in `package.json` as `/home/adetola/notes/clio/.obsidian/plugins/sibyl`. The build outputs `main.js` and copies `manifest.json` to the output directory.

There are no tests.

## Architecture

Sibyl is a desktop-only Obsidian plugin that provides local semantic search and RAG (Retrieval-Augmented Generation) over the user's vault.

**Data flow:**
1. **Indexing** (`indexer.ts`): Notes are chunked into fixed-size character windows with overlap, then embedded using `@xenova/transformers` (running in WASM via ONNX runtime). Embeddings and chunk metadata are stored in IndexedDB via Dexie.
2. **Retrieval** (`retriever.ts`): A query is embedded the same way, then compared against all stored chunk embeddings using cosine similarity (brute-force, in-memory). Top-K chunks are returned.
3. **Generation** (`github-models.ts`): Top chunks are formatted as context and sent to the GitHub Models API (OpenAI-compatible endpoint at `https://models.github.ai/inference`) with the user's GitHub PAT.

**Key files:**
- `src/main.ts` — Plugin entry point; registers commands (`semantic-search`, `reindex-vault`) and vault event hooks for incremental indexing
- `src/store.ts` — Dexie database schema (`notes` and `chunks` tables) and `cosineSimilarity` helper
- `src/types.ts` — `SibylSettings` interface and `DEFAULT_SETTINGS`; also `NoteRecord` and `ChunkRecord` interfaces

**Build shims:** `onnx-shim.js` and `sharp-shim.js` are empty shims aliased via esbuild to prevent Node.js native modules from being bundled. The ONNX WASM binaries are loaded at runtime from `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/`.

**Settings:** GitHub token (PAT with `models:read` scope) and model ID (format: `publisher/model-name`, e.g. `openai/gpt-4o`) are required. Embedding model defaults to `Xenova/bge-small-en-v1.5`.
