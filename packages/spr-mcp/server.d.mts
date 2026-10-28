// Types for the SPR MCP server.
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { SprBook, SprTool } from "@luca-network/spr-sdk";
export declare function mcpTools(book: SprBook): (SprTool & { readOnly?: boolean })[];
export declare function createSprMcpServer(book: SprBook, opts?: { name?: string; version?: string; binding?: boolean }): Server;
