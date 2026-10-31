# Google ADK with SPR. Run with `adk run google_adk_spr` or `adk web` from the examples folder.
#   pip install google-adk
import os

from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from mcp import StdioServerParameters

root_agent = LlmAgent(
    model="gemini-2.5-flash",
    name="research_buyer",
    instruction="Before paying, call record_intent and check_payment. After paying, call record_settlement.",
    tools=[
        McpToolset(
            connection_params=StdioConnectionParams(
                server_params=StdioServerParameters(
                    command="npx",
                    args=["-y", "@luca-network/spr-mcp"],
                    env={**os.environ, "SPR_AGENT_ID": "agt_research", "SPR_ENTITY": "Example Co", "SPR_DIR": "./spr-books"},
                ),
            ),
        )
    ],
)
