# Sunleaf MCP Demo

An MCP server that lets AI assistants such as Claude Desktop and Cursor answer customer questions from a shop's own files: its product catalog, FAQs and policy pages.

**Demo with fictional sample data. Not a client project.**

## What it shows

- **A business's own files, connected to an AI assistant.** Sunleaf Tea Co. is a made-up tea shop. Its catalog, FAQs and policies are plain JSON and Markdown files in [`data/`](data/).
- **Read-only.** The assistant can search and read. It cannot change anything.
- **Cited answers.** Every passage comes with an id the assistant can cite, such as `[faq-006]` or `[policy:returns#opened-tins]`.
- **No guessing.** When the data does not cover a question, the server says so, so the assistant does not make something up.
- **No API keys, no network.** It runs locally over stdio, and nothing leaves your machine.

## Tools, resources and prompt

| Name | Kind | What it does |
|---|---|---|
| `search_products` | tool | Keyword search over the catalog, with optional category and in-stock filters |
| `get_product` | tool | Full details for one product id |
| `search_faqs` | tool | The best-matching FAQ entries, with their ids |
| `get_policy` | tool | The full shipping, returns, privacy or wholesale policy |
| `answer_sources` | tool | Searches FAQs and policies together and returns cited passages, or says the data does not cover the question |
| `sunleaf://catalog` | resource | All products (JSON) |
| `sunleaf://faqs` | resource | All FAQs (JSON) |
| `sunleaf://policies/{name}` | resource template | One policy (Markdown) |
| `customer_reply` | prompt | Drafts a reply to a customer message using only these sources |

## Quick start

You need Node.js 20 or later to run the server. The tests need Node.js 22.12 or later.

```bash
git clone https://github.com/panditfloki/sunleaf-mcp-demo.git
cd sunleaf-mcp-demo
npm install
npm run build
npm test
```

## Connect to Claude Desktop

1. Open the Claude Desktop config file (create it if it does not exist):
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%AppData%\Claude\claude_desktop_config.json`
2. Add the server, using the absolute path to your copy of this repository:

   ```json
   {
     "mcpServers": {
       "sunleaf": {
         "command": "node",
         "args": ["/ABSOLUTE/PATH/TO/sunleaf-mcp-demo/build/index.js"]
       }
     }
   }
   ```

3. Quit Claude Desktop completely and open it again.
4. If the server does not show up, check the logs (`~/Library/Logs/Claude/mcp*.log` on macOS). If Claude cannot find `node`, which is common when Node.js was installed with nvm, replace `"node"` with the full path that `which node` prints.

A ready-to-edit copy is in [`examples/claude_desktop_config.json`](examples/claude_desktop_config.json).

## Connect to Cursor

Add this to `.cursor/mcp.json` in this folder, then open the folder in Cursor:

```json
{
  "mcpServers": {
    "sunleaf": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/build/index.js"]
    }
  }
}
```

To use it in every project, put the same entry in `~/.cursor/mcp.json` with an absolute path instead of `${workspaceFolder}`. In Cursor Settings, the MCP section should then show `sunleaf` as connected. A copy is in [`examples/cursor-mcp.json`](examples/cursor-mcp.json).

## Test with MCP Inspector

MCP Inspector needs Node.js 22.19 or later.

```bash
npm run inspect
```

This opens the Inspector in your browser, where you can list the tools and call them. For a scripted check:

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/list
```

## Questions to try

- "Do you have a caffeine-free tea under $15?"
- "What is your return policy for opened tins?"
- "How should I brew the Darjeeling first flush?"
- "Do you ship to Canada?" The data does not mention Canada, so the assistant should say this is not covered instead of guessing.

## Use your own data

Point the server at your own folder with the `SUNLEAF_DATA_DIR` environment variable. The folder needs the same layout:

```text
my-shop/
  products.json
  faqs.json
  policies/
    shipping.md
    returns.md
    privacy.md
    wholesale.md
```

- **products.json**: an array of products with `id`, `name`, `category`, `price_inr`, `price_usd`, `sizes` (list), `in_stock` (true or false), `tags` (list) and `short_description`.
- **faqs.json**: an array of FAQs with `id`, `question`, `answer` and `tags` (list).
- **policies/**: Markdown files. Each `## ` heading becomes a separate section that can be cited. Missing policy files are skipped.

The server checks both JSON files when it starts, and stops with a clear message if a field is missing or an id is used twice.

In Claude Desktop, set the variable in the server entry:

```json
"sunleaf": {
  "command": "node",
  "args": ["/ABSOLUTE/PATH/TO/sunleaf-mcp-demo/build/index.js"],
  "env": { "SUNLEAF_DATA_DIR": "/ABSOLUTE/PATH/TO/my-shop" }
}
```

Use an absolute path. A relative path is resolved from this package's folder, not from wherever the AI client starts.

## Screenshots

Coming soon: Claude Desktop (`docs/claude-desktop.png`), Cursor (`docs/cursor.png`), MCP Inspector (`docs/inspector.png`) and a short demo GIF (`docs/demo.gif`).

<!--
![Claude Desktop](docs/claude-desktop.png)
![Cursor](docs/cursor.png)
![MCP Inspector](docs/inspector.png)
![Demo](docs/demo.gif)
-->

## Security notes

- **Read-only.** No tool writes, deletes or sends anything.
- **Local files only.** The server reads its data folder and nothing else. It makes no network calls.
- **stdio.** It runs as a local process that your AI client starts and stops.
- **Real business data.** Whatever the tools return is shown to the AI client and, through it, to the model provider. Only put in the data folder what you are comfortable sharing that way.

## How it works

- `src/index.ts` starts the server over stdio. It never writes to stdout, because stdout carries the MCP protocol. Logs go to stderr.
- `src/server.ts` registers the tools, resources and prompt with the official MCP TypeScript SDK (`@modelcontextprotocol/server` v2).
- `src/search.ts` is a small offline keyword search. A word in a product name or FAQ question counts 3 times, in tags 2 times and in body text once, and rare words count more than common ones. `answer_sources` only returns a passage that covers at least half of the question (weighted by rarity), which is what turns "Do you ship to Canada?" into "not covered".
- `src/data.ts` loads and checks the data folder.

## Development

```bash
npm run dev    # run from source with tsx
npm test       # unit tests and an in-process client/server test
npm run build  # compile to build/
```

## License

MIT. See [LICENSE](LICENSE).

---

© 2026 dydxfx · https://dydxfx.com
