# sibyl (wip)

Local semantic search and RAG (Retrieval-Augmented Generation) for your Obsidian vault. Ask questions in natural language and get AI-generated answers grounded in your own notes.

> Desktop only. Requires Obsidian 0.15.0+.

## How it works

1. Sibyl chunks your markdown notes and generates embeddings locally using a small WASM-based model (`bge-small-en-v1.5` via `@xenova/transformers`). No data leaves your machine during indexing.
2. When you ask a question in the Sibyl sidebar, your query is embedded the same way and compared against stored chunk embeddings to find the most relevant passages.
3. The top results are sent as context to a configurable chat provider, and Sibyl asks the model to cite those retrieved chunks inline.

## Setup

1. Install the plugin.
2. Open **Settings → Sibyl**.
3. Choose an LLM provider in **Settings → Sibyl**.
4. Enter the provider credentials, model, and base URL for your selected provider.
5. Run the **Reindex Vault** command to build the initial index. After that, notes are indexed incrementally on save.

## Commands

| Command | Description |
|---|---|
| **Open Sibyl Chat** | Open the persistent Sibyl sidebar for multi-turn conversations |
| **Reindex Vault** | Rebuild the full index from scratch (use if the index gets out of sync) |

## Configuration

| Setting | Default | Description |
|---|---|---|
| LLM Provider | `github` | `github`, `openrouter`, `openai_compatible`, or `google` |
| Provider API Key | — | Token or API key for the selected provider |
| Provider Model | Varies | Model name or slug for the selected provider |
| Provider Base URL | Varies | Base URL used for chat completion requests |
| Temperature | blank | Optional generation setting; omitted when unsupported |
| Top K | `5` | Number of chunks retrieved per query |
| Similarity Threshold | `0.2` | Minimum cosine similarity required for a retrieved chunk |
| Chunk Size | `500` | Characters per chunk |
| Ignore Patterns | `.obsidian/`, `Templates/`, `Archive/` | Paths excluded from indexing |

Search filters:
- Prefix a folder with `@`, for example `@projects/roadmap`.
- Prefix a tag with `#`, for example `#meetings`.
- You can combine them in one query, for example `@clients #followup summarize next actions`.

Google Gemini defaults:
- Base URL: `https://generativelanguage.googleapis.com/v1beta`
- Model: `gemini-3-flash-preview`
- Auth: API key via Google AI Studio

## Development

```bash
npm install
npm run dev        # watch mode, output to project root
npm run dev:vault  # watch mode, output directly to vault plugins folder
npm run build      # production build
```
