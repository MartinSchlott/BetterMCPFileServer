import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { 
  validatePath, 
  pathAliases,
  toAliasPath,
  isWriteOperationToRoot,
  listRootDirectory
} from "../pathUtils.js";
import { 
  ManageFolderSchema 
} from "../schemas.js";

// Manage folder operations (create, rename, delete)
export async function manageFolder(
  args: z.infer<typeof ManageFolderSchema>, 
  allowedDirectories: string[]
): Promise<string> {
  // Special case for root directory listing
  if (args.folderPath === 'root' || args.folderPath === '/') {
    if (args.action !== 'create') {
      throw new Error("Only listing operations are allowed on the root directory");
    }
  }
  
  // Block operations on root
  if (isWriteOperationToRoot(args.action, args.folderPath)) {
    throw new Error(`${args.action} operations to root directory are not allowed`);
  }
  
  const validFolderPath = await validatePath(args.folderPath, allowedDirectories);
  
  switch (args.action) {
    case "create": {
      await fs.mkdir(validFolderPath, { recursive: true });
      // Return alias path in the response
      const aliasPath = pathAliases.length > 0 ? toAliasPath(validFolderPath) : args.folderPath;
      return `Successfully created directory ${aliasPath}`;
    }
    
    case "delete": {
      await fs.rm(validFolderPath, { recursive: true, force: true });
      // Return alias path in the response
      const aliasPath = pathAliases.length > 0 ? toAliasPath(validFolderPath) : args.folderPath;
      return `Successfully deleted directory ${aliasPath}`;
    }
    
    case "rename": {
      if (!args.newFolderPath) {
        throw new Error("newFolderPath is required for rename action");
      }
      
      // Block operations on root
      if (isWriteOperationToRoot(args.action, args.newFolderPath)) {
        throw new Error(`${args.action} operations to root directory are not allowed`);
      }
      
      const validNewPath = await validatePath(args.newFolderPath, allowedDirectories);
      await fs.rename(validFolderPath, validNewPath);
      
      // Return alias paths in the response
      const sourceAliasPath = pathAliases.length > 0 ? toAliasPath(validFolderPath) : args.folderPath;
      const destAliasPath = pathAliases.length > 0 ? toAliasPath(validNewPath) : args.newFolderPath;
      
      return `Successfully renamed directory ${sourceAliasPath} to ${destAliasPath}`;
    }
    
    default:
      throw new Error(`Unknown folder action: ${args.action}`);
  }
} 