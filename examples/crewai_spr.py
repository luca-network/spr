# CrewAI with SPR: the agent records each payment as a sealed record in your own book.
#   pip install crewai "crewai-tools[mcp]"
import os

from crewai import Agent, Crew, Task
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

spr = StdioServerParameters(
    command="npx",
    args=["-y", "@luca-network/spr-mcp"],
    env={**os.environ, "SPR_AGENT_ID": "agt_research", "SPR_ENTITY": "Example Co", "SPR_DIR": "./spr-books"},
)

with MCPServerAdapter(spr) as tools:
    buyer = Agent(
        role="Research buyer",
        goal="Buy the data the team needs, and record every payment in the company's book",
        backstory="Before paying, call record_intent and check_payment. After paying, call record_settlement.",
        tools=tools,
    )
    task = Task(
        description="Record the intent to buy one month of market data from Example Data for at most 200.00 USD.",
        expected_output="The intent ID and whether check_payment approves a 150.00 USD payment",
        agent=buyer,
    )
    print(Crew(agents=[buyer], tasks=[task]).kickoff())
