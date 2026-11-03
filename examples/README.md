# Examples

Each example connects an agent framework to the SPR MCP server running on your machine (`npx -y @luca-network/spr-mcp`). The agent gets the SPR tools: `record_intent` before paying, `check_payment`, `record_settlement` after paying, and the rest listed in [`packages/spr-mcp`](../packages/spr-mcp).

| Framework | File |
|---|---|
| CrewAI | [`crewai_spr.py`](crewai_spr.py) |
| Microsoft Agent Framework | [`microsoft_agent_framework_spr.py`](microsoft_agent_framework_spr.py) |
| Google ADK | [`google_adk_spr/agent.py`](google_adk_spr/agent.py) |
| Claude Agent SDK | [`claude_agent_sdk_spr.py`](claude_agent_sdk_spr.py) |

All of them need Node.js 20 or later for `npx`, and set:

- `SPR_AGENT_ID`: your agent's ID, such as `agt_research`
- `SPR_ENTITY`: the company it pays for
- `SPR_DIR`: the folder for the book (it holds the company's private key, `key.pem`: keep it out of source control)

Each framework's own version and model settings change often. If an import has moved, the framework's MCP documentation has the current form; the SPR part (the command, its arguments and the settings) stays the same.

## The checks and the merchant's side, without a framework

Two short scripts that use the SDKs directly, in a temporary folder:

| What it shows | File |
|---|---|
| A payee the intent doesn't name is declined before paying, and so is the same invoice paid twice (JavaScript) | [`payee_and_duplicate_checks.mjs`](payee_and_duplicate_checks.mjs) |
| A merchant records the buyer's sealed intent and authentication, and writes one payment's dispute evidence (Python) | [`merchant_dispute_pack.py`](merchant_dispute_pack.py) |
