# Claude Agent SDK with SPR.
#   pip install claude-agent-sdk
import asyncio

from claude_agent_sdk import ClaudeAgentOptions, query


async def main():
    options = ClaudeAgentOptions(
        mcp_servers={
            "spr": {
                "type": "stdio",
                "command": "npx",
                "args": ["-y", "@luca-network/spr-mcp"],
                "env": {"SPR_AGENT_ID": "agt_research", "SPR_ENTITY": "Example Co", "SPR_DIR": "./spr-books"},
            }
        },
        allowed_tools=["mcp__spr__record_intent", "mcp__spr__check_payment", "mcp__spr__record_settlement", "mcp__spr__get_intent"],
    )
    async for message in query(
        prompt="Record the intent to buy one month of market data from Example Data for at most 200.00 USD, "
        "then check a 150.00 USD payment against it.",
        options=options,
    ):
        print(message)


asyncio.run(main())
