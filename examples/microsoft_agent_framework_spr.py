# Microsoft Agent Framework with SPR.
#   pip install agent-framework
import asyncio
import os

from agent_framework import Agent, MCPStdioTool
from agent_framework.openai import OpenAIChatClient


async def main():
    async with (
        MCPStdioTool(
            name="spr",
            command="npx",
            args=["-y", "@luca-network/spr-mcp"],
            env={**os.environ, "SPR_AGENT_ID": "agt_research", "SPR_ENTITY": "Example Co", "SPR_DIR": "./spr-books"},
        ) as spr,
        Agent(
            client=OpenAIChatClient(),
            name="ResearchBuyer",
            instructions="Before paying, call record_intent and check_payment. After paying, call record_settlement.",
        ) as agent,
    ):
        result = await agent.run(
            "Record the intent to buy one month of market data from Example Data for at most 200.00 USD, "
            "then check a 150.00 USD payment against it.",
            tools=spr,
        )
        print(result)


if __name__ == "__main__":
    asyncio.run(main())
