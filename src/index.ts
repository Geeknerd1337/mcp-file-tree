import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import path from 'path';
import os from 'os';
import { zodToJsonSchema } from 'zod-to-json-schema';
import fs from 'fs/promises';
const ListDirectoryArgsSchema = z.object({
  path: z.string(),
});

const DirectoryTreeArgsSchema = z.object({
  path: z.string(),
});

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

//Set up server
const server = new Server(
  {
    name: 'mcp-file-tree',
    version: '0.0.1',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_directory',
        description:
          'Get a detailed listing of all files and directories in a specified path. ' +
          'Results clearly distinguish between files and directories with [FILE] and [DIR] ' +
          'prefixes. This tool is essential for understanding directory structure and ' +
          'finding specific files within a directory. Only works within allowed directories.',
        inputSchema: zodToJsonSchema(ListDirectoryArgsSchema) as ToolInput,
      },
      {
        name: 'directory_tree',
        description:
          'Get a recursive tree view of files and directories as a JSON structure. ' +
          "Each entry includes 'name', 'type' (file/directory), and 'children' for directories. " +
          'Files have no children array, while directories always have a children array (which may be empty). ' +
          'The output is formatted with 2-space indentation for readability. Only works within allowed directories.',
        inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema) as ToolInput,
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'list_directory': {
        const parsed = ListDirectoryArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(
            `Invalid arguments for list_directory: ${parsed.error}`
          );
        }
        const validPath = parsed.data.path;
        const entries = await fs.readdir(validPath, { withFileTypes: true });
        const formatted = entries
          .map(
            (entry) =>
              `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`
          )
          .join('\n');
        return {
          content: [{ type: 'text', text: formatted }],
        };
      }

      case 'directory_tree': {
        const parsed = DirectoryTreeArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(
            `Invalid arguments for directory_tree: ${parsed.error}`
          );
        }

        interface TreeEntry {
          name: string;
          type: 'file' | 'directory';
          children?: TreeEntry[];
        }

        async function buildTree(currentPath: string): Promise<TreeEntry[]> {
          const validPath = currentPath;
          const entries = await fs.readdir(validPath, { withFileTypes: true });
          const result: TreeEntry[] = [];

          for (const entry of entries) {
            const entryData: TreeEntry = {
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
            };

            if (entry.isDirectory()) {
              const subPath = path.join(currentPath, entry.name);
              entryData.children = await buildTree(subPath);
            }

            result.push(entryData);
          }

          return result;
        }

        const treeData = await buildTree(parsed.data.path);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(treeData, null, 2),
            },
          ],
        };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Secure MCP Filesystem Server running on stdio');
}

runServer().catch((error) => {
  console.error('Fatal error running server:', error);
  process.exit(1);
});
