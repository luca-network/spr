# SPR MCP server

SPR, the Sealed Payment Record, as an MCP server. Any MCP client (Claude Desktop, Cursor, your own agent) can declare each payment before making it, check it, and seal the record afterwards. Records are sealed with your company's own key, in a folder on your own machine, with no call to Luca. Apache-2.0.

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
| `export_package` | A copy of the book with a sealed manifest, for an auditor or a counterparty |

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

The folder holds the company's private key (`key.pem`). Keep it out of source control.
