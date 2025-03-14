import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { 
  validatePath, 
  pathAliases,
  toAliasPath,
  isWriteOperationToRoot 
} from "../pathUtils.js";
import { 
  WriteFileSchema, 
  ReadFileContentSchema, 
  EditFileSchema, 
  ManageFileSchema 
} from "../schemas.js";
import { applyFileEdits } from "../editUtils.js";

// Write file operation
export async function writeFile(
  args: z.infer<typeof WriteFileSchema>, 
  allowedDirectories: string[]
): Promise<string> {
  // Block write operations to root
  if (isWriteOperationToRoot("write", args.filePath)) {
    throw new Error("Write operations to root directory are not allowed");
  }
  
  const validPath = await validatePath(args.filePath, allowedDirectories);
  await fs.writeFile(validPath, args.content, "utf-8");
  
  // Return alias path in the response
  const aliasPath = pathAliases.length > 0 ? toAliasPath(validPath) : args.filePath;
  return `Successfully wrote to ${aliasPath}`;
}

// Read file operation
export async function readFileContent(
  args: z.infer<typeof ReadFileContentSchema>, 
  allowedDirectories: string[]
): Promise<string> {
  const validPath = await validatePath(args.filePath, allowedDirectories);
  return await fs.readFile(validPath, "utf-8");
}

// Edit file operation
export async function editFile(
  args: z.infer<typeof EditFileSchema>, 
  allowedDirectories: string[]
): Promise<string> {
  // Block edit operations to root
  if (isWriteOperationToRoot("write", args.filePath)) {
    throw new Error("Edit operations to root directory are not allowed");
  }
  
  const validPath = await validatePath(args.filePath, allowedDirectories);
  
  try {
    const diffResult = await applyFileEdits(
      validPath, 
      args.edits, 
      args.dryRun
    );
    
    const actionMsg = args.dryRun 
      ? "Dry run completed. Here's what would change:" 
      : "File edited successfully. Here's what changed:";
    
    return `${actionMsg}\n\n${diffResult}`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to edit file: ${errorMessage}`);
  }
}

// Manage file operations (move, rename, copy, delete)
export async function manageFile(
  args: z.infer<typeof ManageFileSchema>, 
  allowedDirectories: string[]
): Promise<string> {
  // Block operations on root
  if (isWriteOperationToRoot(args.action, args.filePath)) {
    throw new Error(`${args.action} operations to root directory are not allowed`);
  }
  
  const validSourcePath = await validatePath(args.filePath, allowedDirectories);
  
  switch (args.action) {
    case "delete": {
      await fs.unlink(validSourcePath);
      // Return alias path in the response
      const aliasPath = pathAliases.length > 0 ? toAliasPath(validSourcePath) : args.filePath;
      return `Successfully deleted ${aliasPath}`;
    }
    
    case "move":
    case "rename": {
      if (!args.newFilePath) {
        throw new Error(`newFilePath is required for ${args.action} action`);
      }
      
      // Block operations on root
      if (isWriteOperationToRoot(args.action, args.newFilePath)) {
        throw new Error(`${args.action} operations to root directory are not allowed`);
      }
      
      const validDestPath = await validatePath(args.newFilePath, allowedDirectories);
      await fs.rename(validSourcePath, validDestPath);
      
      // Return alias paths in the response
      const sourceAliasPath = pathAliases.length > 0 ? toAliasPath(validSourcePath) : args.filePath;
      const destAliasPath = pathAliases.length > 0 ? toAliasPath(validDestPath) : args.newFilePath;
      
      return `Successfully ${args.action === "move" ? "moved" : "renamed"} ${sourceAliasPath} to ${destAliasPath}`;
    }
    
    case "copy": {
      if (!args.newFilePath) {
        throw new Error("newFilePath is required for copy action");
      }
      
      // Block operations on root
      if (isWriteOperationToRoot(args.action, args.newFilePath)) {
        throw new Error(`${args.action} operations to root directory are not allowed`);
      }
      
      const validDestPath = await validatePath(args.newFilePath, allowedDirectories);
      await fs.copyFile(validSourcePath, validDestPath);
      
      // Return alias paths in the response
      const sourceAliasPath = pathAliases.length > 0 ? toAliasPath(validSourcePath) : args.filePath;
      const destAliasPath = pathAliases.length > 0 ? toAliasPath(validDestPath) : args.newFilePath;
      
      return `Successfully copied ${sourceAliasPath} to ${destAliasPath}`;
    }
    
    default:
      throw new Error(`Unknown file action: ${args.action}`);
  }
} 