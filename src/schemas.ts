import { z } from "zod";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";

// Utility type
export const ToolInputSchema = ToolSchema.shape.inputSchema;
export type ToolInput = z.infer<typeof ToolInputSchema>;

// File operation schemas
export const WriteFileSchema = z.object({
  filePath: z.string(),
  content: z.string(),
});

export const ReadFileContentSchema = z.object({
  filePath: z.string(),
});

export const EditFileSchema = z.object({
  filePath: z.string(),
  edits: z.array(z.object({
    oldText: z.string(),
    newText: z.string(),
  })),
  dryRun: z.boolean().optional().default(false),
});

// File management schemas
export const ManageFileSchema = z.object({
  action: z.enum(["move", "rename", "copy", "delete"]),
  filePath: z.string(),
  newFilePath: z.string().optional(),
}).refine(data => {
  if (["move", "rename", "copy"].includes(data.action) && !data.newFilePath) {
    return false;
  }
  return true;
}, {
  message: "newFilePath is required for 'move', 'rename', and 'copy' actions",
  path: ["newFilePath"]
});

// Folder operation schemas
export const ManageFolderSchema = z.object({
  action: z.enum(["create", "rename", "delete"]),
  folderPath: z.string(),
  newFolderPath: z.string().optional(),
}).refine(data => {
  if (data.action === "rename" && !data.newFolderPath) {
    return false;
  }
  return true;
}, {
  message: "newFolderPath is required for 'rename' action",
  path: ["newFolderPath"]
}); 