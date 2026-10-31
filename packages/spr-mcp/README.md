# SPR MCP server

SPR, the Sealed Payment Record, as an MCP server. Any MCP client (Claude Desktop, Cursor, your own agent) can declare each payment before making it, check it, and seal the record afterwards. Records are sealed with your company's own key, in a folder on your own machine, with no call to Luca. Apache-2.0.

This server runs on your machine and makes no call to Luca, unless you add `LUCA_URL` and `LUCA_API_KEY` for `send_to_luca`. It checks each payment against the agent's declared intent: the cap, the expiry, and whether the intent was withdrawn. An optional `mandate.json` in the book's folder adds one limit across all intents; whoever keeps the folder writes it, so results say `authority: "self-declared"`. Confirmation from the rail, ERP posting and mandates approved by finance are Luca's hosted service: see "Local SPR and hosted Luca" in the repository's README.

## Claude Desktop

Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "spr": {
      "command": "npx",
      "args": ["-y", "@luca-network/spr-mcp"],
      "env": { "SPR_AGENT_ID": "agt_research", "SPR_ENTITY": "Example Co", "SPR_DIR": "/Users/you/spr-books" }
    }
  }
}
```

## Cursor

The same block in `.cursor/mcp.json`.

## Claude Code

```
claude mcp add spr -e SPR_AGENT_ID=agt_research -e SPR_ENTITY="Example Co" -- npx -y @luca-network/spr-mcp
```

## Agent frameworks

CrewAI, Microsoft Agent Framework, Google ADK and the Claude Agent SDK connect to this server in a few lines: see [`examples/`](https://github.com/luca-network/spr/tree/main/examples). Any other MCP client runs `npx -y @luca-network/spr-mcp` over stdio with `SPR_AGENT_ID` and `SPR_ENTITY` set.

## Requirements

Node.js 20 or later. The packages are ES modules: load them with `import`, not `require`.

## Tools

| Tool | What it does |
|---|---|
| `record_intent` | Declare what you are about to buy, why, and the most you may pay |
| `check_payment` | Before paying: approve or decline, with the reasons |
| `record_settlement` | After paying: seal the record, matched to its intent |
| `cancel_intent` | Withdraw an intent you will not pay |
| `get_intent` | One intent: open, matched, expired or withdrawn |
| `verify_record` | Check a record's seal |
| `list_records` | The book's current records |
| `export_package` | A copy of the book with a sealed manifest, into a named folder under the export folder, for an auditor or a counterparty |
| `send_to_luca` | Send the book to Luca's hosted service (only when `LUCA_URL` and `LUCA_API_KEY` are set) |

Check an export with `npx spr-verify <folder>`, with no Luca code.

## Settings

| Variable | Meaning |
|---|---|
| `SPR_AGENT_ID` | The agent's ID (required) |
| `SPR_ENTITY` | The company it pays for (required) |
| `SPR_DIR` | The book's folder (default `./spr-books`) |
| `SPR_OWNER` | The person responsible for the agent |
| `SPR_TIME_ZONE` | The company's time zone, for accounting dates (default UTC) |
| `SPR_BINDING` | `on` to return the nonce to sign with each intent |
| `SPR_EXPORT_DIR` | The folder exports go under (default: `exports` inside the book's folder). The `export_package` tool takes a folder name, never a path |
| `LUCA_URL`, `LUCA_API_KEY` | Optional: Luca's address and an API key, which add the `send_to_luca` tool |

The folder holds the company's private key (`key.pem`). Keep it out of source control. Another process can use the same folder at the same time, such as a script or a second MCP client; each write takes `book.lock` for a moment, so nothing is lost.
