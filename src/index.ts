#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { 
  validateDirectories,
  parseAliasArgs,
  pathAliases
} from "./pathUtils.js";
import {
  writeFile,
  readFileContent,
  editFile,
  manageFile
} from "./tools/fileTools.js";
import {
  manageFolder
} from "./tools/folderTools.js";
import {
  searchFilesAndFolders,
  SearchFilesAndFoldersSchema
} from "./tools/searchTools.js";
import {
  ToolInput,
  WriteFileSchema,
  ReadFileContentSchema,
  EditFileSchema,
  ManageFileSchema,
  ManageFolderSchema,
} from "./schemas.js";

// Command line argument parsing
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: mcp-file-server <alias>:<allowed-directory> [<alias2>:<directory2>...]");
  process.exit(1);
}

// Initialize path aliases
await parseAliasArgs(args).then(aliases => {
  // Copy all aliases to the pathAliases array
  pathAliases.push(...aliases);
});

// Also create an allowedDirectories array for backwards compatibility
const allowedDirectories = pathAliases.map(pa => pa.normalizedPath);

// Validate that all directories exist and are accessible
await validateDirectories(args);

// Server setup
const server = new Server(
  {
    name: "mcp-file-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "writeFile",
        description: "Create or update a file at the specified path with the given content.",
        inputSchema: zodToJsonSchema(WriteFileSchema) as ToolInput,
      },
      {
        name: "readFileContent",
        description: "Retrieve the content of a specified file.",
        inputSchema: zodToJsonSchema(ReadFileContentSchema) as ToolInput,
      },
      {
        name: "editFile",
        description: "Make targeted changes to specific text portions within a file without rewriting the entire content.",
        inputSchema: zodToJsonSchema(EditFileSchema) as ToolInput,
      },
      {
        name: "manageFile",
        description: "Perform actions like move, rename, copy, or delete a file.",
        inputSchema: zodToJsonSchema(ManageFileSchema) as ToolInput,
      },
      {
        name: "manageFolder",
        description: "Perform actions like create, rename, or delete a folder.",
        inputSchema: zodToJsonSchema(ManageFolderSchema) as ToolInput,
      },
      {
        name: "searchFilesAndFolders",
        description: "Search for matching files and folders using glob patterns. Results always include path and type fields. For simple directory listing, use pattern '*'. Only set includeMetadata to true when file size or timestamps are needed - this adds size, created, and modified fields.",
        inputSchema: zodToJsonSchema(SearchFilesAndFoldersSchema) as ToolInput,
      },
    ],
  };
});

// Tool implementations
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "writeFile": {
        const parsed = WriteFileSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for writeFile: ${parsed.error}`);
        }
        
        const result = await writeFile(parsed.data, allowedDirectories);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "readFileContent": {
        const parsed = ReadFileContentSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for readFileContent: ${parsed.error}`);
        }
        
        const content = await readFileContent(parsed.data, allowedDirectories);
        return {
          content: [{ type: "text", text: content }],
        };
      }

      case "editFile": {
        const parsed = EditFileSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for editFile: ${parsed.error}`);
        }
        
        const result = await editFile(parsed.data, allowedDirectories);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "manageFile": {
        const parsed = ManageFileSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for manageFile: ${parsed.error}`);
        }
        
        const result = await manageFile(parsed.data, allowedDirectories);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "manageFolder": {
        const parsed = ManageFolderSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for manageFolder: ${parsed.error}`);
        }
        
        const result = await manageFolder(parsed.data, allowedDirectories);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "searchFilesAndFolders": {
        const parsed = SearchFilesAndFoldersSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for searchFilesAndFolders: ${parsed.error}`);
        }
        
        const validResults = await searchFilesAndFolders(parsed.data, allowedDirectories);
        return {
          content: [{ type: "text", text: JSON.stringify(validResults, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP File Server running on stdio");
  if (pathAliases.length > 0) {
    console.error("Configured aliases:");
    pathAliases.forEach(pa => {
      console.error(`  ${pa.alias} => ${pa.fullPath}`);
    });
  } else {
    console.error("Allowed directories:", allowedDirectories);
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});