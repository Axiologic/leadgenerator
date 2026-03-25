# Lead Generator

A lightweight, zero-dependency web application for discovering and managing marketing leads using LLMs.

## Features

- **Discovery** — Find people, organizations, and research projects via LLM-powered search
- **Projects** — Collect consortiums/associations, then extract leads from their partner pages
- **Recursive Scraper** — Crawl websites (HTML, PDF, DOCX), extract leads with pagination
- **Lead Management** — Score, enrich, filter, add notes, change status, export/import
- **Lead Scoring** — LLM analyzes profiles, detects booking links, generates personalized contact messages
- **Team Collaboration** — Export/import leads JSON for merging across team members

## Installation

```bash
git clone <this-repo>
cd leadgenerator
npm install
```

`npm install` automatically clones [AchillesAgentLib](https://github.com/OutfinityResearch/achillesAgentLib) into `node_modules/`.

## Configuration

Create a `.env` file in the project directory (or any parent directory):

```
SOUL_GATEWAY_API_KEY=your-key-here
```

AchillesAgentLib auto-discovers `.env` files by walking up from the working directory.

## Running

```bash
npm start
```

Open `http://localhost:3000` in your browser.

## Testing

```bash
npm test          # All tests (unit + integration, requires API key)
npm run test:unit # Unit tests only (no API key needed)
```

## Project Structure

```
src/
  server.mjs          — HTTP server, API routes
  marketingAgent.mjs   — Discovery, scraping, scoring logic
  llmPipeline.mjs      — LLM call pipeline with JSON parsing and fallback
  pageCache.mjs        — Disk-based page cache, PDF/DOCX text extraction
  storage.mjs          — JSON file persistence for leads and config
  public/              — Frontend SPA (vanilla HTML/CSS/JS)
tests/
  test-parsing.mjs     — Unit tests for JSON extraction (12 tests)
  test-pipeline.mjs    — Integration tests for LLM pipeline (5 tests)
  test-extraction.mjs  — Integration tests for lead extraction (4 tests)
data/                  — Runtime data (gitignored)
  leads.json           — Lead database
  config.json          — App configuration
  cache/               — Cached web pages (one file per URL)
docs/specs/            — Design specifications
```

## LLM Task Configuration

Each task uses a separately configurable model/tier (set in Settings):

| Task | Purpose | Recommended |
|------|---------|-------------|
| Discovery | Find entities for a topic | `exa-search` (search model) |
| Suggest | Generate search query ideas | `copilot-gpt-4o` (instruct) |
| Extraction | Extract leads from pages | `copilot-gpt-4o` (instruct) |
| Parse | Structure raw LLM output into JSON | `copilot-gpt-4.1` (instruct) |
| Scoring | Score and enrich leads | `copilot-gpt-4o` (instruct) |

Search models (exa-search, Tavily) find real entities but can't produce JSON. The pipeline automatically falls back to the Parse model when the primary model returns unstructured text.

## Authentication

Optional password protection. Set via Settings → Password. Stored as SHA-256 hash. Token persisted in browser localStorage.

## License

ISC
