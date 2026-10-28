#!/usr/bin/env node
// npx @luca-network/spr-mcp — SPR as an MCP server over stdio.
//
//   SPR_AGENT_ID   the agent's ID, e.g. agt_research            (required)
//   SPR_ENTITY     the company it pays for, e.g. "Example Co"   (required)
//   SPR_DIR        the book's folder (default: ./spr-books)
//   SPR_OWNER      the person responsible for the agent
//   SPR_TIME_ZONE  the company's time zone for accounting dates (default UTC)
//   SPR_BINDING    "on" to return the nonce to sign with each intent
//
// Nothing may be printed to stdout: it carries the protocol.
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SprBook } from "@luca-network/spr-sdk";
import { createSprMcpServer } from "../server.mjs";

const env = process.env;
if (!env.SPR_AGENT_ID || !env.SPR_ENTITY) {
  console.error("Set SPR_AGENT_ID (the agent) and SPR_ENTITY (the company it pays for). Optional: SPR_DIR, SPR_OWNER, SPR_TIME_ZONE, SPR_BINDING=on.");
  process.exit(1);
}
const binding = (env.SPR_BINDING ?? "").toLowerCase() === "on";
const book = new SprBook({ dir: resolve(env.SPR_DIR ?? "spr-books"), agentId: env.SPR_AGENT_ID, entity: env.SPR_ENTITY,
  owner: env.SPR_OWNER ?? null, timeZone: env.SPR_TIME_ZONE ?? "UTC", binding });
await createSprMcpServer(book, { binding }).connect(new StdioServerTransport());
console.error(`SPR MCP server on stdio: sealing in ${book.dir} with key ${book.keyId}`);
