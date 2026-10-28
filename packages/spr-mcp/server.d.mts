// Types for the SPR MCP server.
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { SprBook, SprTool, LucaOptions } from "@luca-network/spr-sdk";
export interface SprMcpOptions { name?: string; version?: string; binding?: boolean; /** Adds the send_to_luca tool. */ luca?: LucaOptions }
export declare function mcpTools(book: SprBook, opts?: SprMcpOptions): (SprTool & { readOnly?: boolean })[];
export declare function createSprMcpServer(book: SprBook, opts?: SprMcpOptions): Server;
