import fs from "fs/promises";
import path from "path";
import os from "os";

// Interface for path aliases
export interface PathAlias {
  alias: string;
  fullPath: string;
  normalizedPath: string; // Lowercase, normalized for comparison
}

// Store mapping between aliases and full paths
export const pathAliases: PathAlias[] = [];

// Normalize all paths consistently
export function normalizePath(p: string): string {
  return path.normalize(p).toLowerCase();
}

export function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

// Process command line arguments to get path aliases
export async function parseAliasArgs(args: string[]): Promise<PathAlias[]> {
  if (args.length === 0) {
    console.error("Usage: mcp-file-server <alias>:<allowed-directory> [<alias2>:<directory2>...]");
    process.exit(1);
  }
  
  const aliases: PathAlias[] = [];
  
  // Parse and validate all aliases
  for (const arg of args) {
    const parts = arg.split(':', 2);
    
    // Check if the argument contains a colon
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      console.error(`Error: Invalid alias:path format - ${arg}`);
      process.exit(1);
    }
    
    const [alias, fullPath] = parts;
    
    // Check alias format (no slashes, special chars)
    if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
      console.error(`Error: Alias must only contain letters, numbers, underscores, or hyphens - ${alias}`);
      process.exit(1);
    }
    
    // Check for duplicate aliases
    if (aliases.some(pa => pa.alias === alias)) {
      console.error(`Error: Duplicate alias - ${alias}`);
      process.exit(1);
    }
    
    const expandedPath = expandHome(fullPath);
    const absolutePath = path.resolve(expandedPath);
    
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        console.error(`Error: ${fullPath} is not a directory`);
        process.exit(1);
      }
      
      aliases.push({
        alias,
        fullPath: absolutePath,
        normalizedPath: normalizePath(absolutePath)
      });
    } catch (error) {
      console.error(`Error accessing directory ${fullPath}:`, error);
      process.exit(1);
    }
  }
  
  return aliases;
}

// Process command line arguments to get allowed directories (legacy method)
export function initAllowedDirectories(dirs: string[]): string[] {
  return dirs.map(dir => 
    normalizePath(path.resolve(expandHome(dir)))
  );
}

// Convert an alias path to an absolute filesystem path
export function resolveAliasPath(aliasPath: string): string {
  // Special case: root
  if (aliasPath === 'root' || aliasPath === '/') {
    return 'root';
  }
  
  // Split path into components
  const parts = aliasPath.split('/');
  const requestedAlias = parts[0];
  
  // Find matching alias
  const matchingAlias = pathAliases.find(pa => pa.alias === requestedAlias);
  if (!matchingAlias) {
    throw new Error(`Unknown alias: ${requestedAlias}`);
  }
  
  // Replace alias with full path
  parts[0] = matchingAlias.fullPath;
  return path.join(...parts);
}

// Convert an absolute filesystem path to an alias path
export function toAliasPath(absolutePath: string): string {
  // Find the longest matching alias path
  let bestMatch: PathAlias | null = null;
  let longestPrefix = 0;
  
  const normalizedPath = normalizePath(absolutePath);
  
  for (const alias of pathAliases) {
    if (normalizedPath.startsWith(alias.normalizedPath) && 
        alias.normalizedPath.length > longestPrefix) {
      bestMatch = alias;
      longestPrefix = alias.normalizedPath.length;
    }
  }
  
  if (!bestMatch) {
    throw new Error(`Path outside alias directories: ${absolutePath}`);
  }
  
  // Replace the matching prefix with the alias
  const relativePath = path.relative(bestMatch.fullPath, absolutePath);
  return path.join(bestMatch.alias, relativePath);
}

// Check if a path is a write operation to root
export function isWriteOperationToRoot(operation: string, path: string): boolean {
  return (operation === "write" || operation === "create" || operation === "delete") && 
         (path === "root" || path === "/");
}

// Validate directory arguments
export async function validateDirectories(dirs: string[]): Promise<void> {
  await Promise.all(dirs.map(async (dir) => {
    try {
      // Extract the path part if it's an alias:path format
      const pathPart = dir.includes(':') ? dir.split(':', 2)[1] : dir;
      const stats = await fs.stat(pathPart);
      if (!stats.isDirectory()) {
        console.error(`Error: ${pathPart} is not a directory`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error accessing directory ${dir}:`, error);
      process.exit(1);
    }
  }));
}

// Handle the special case for listing root (all aliases)
export async function listRootDirectory(): Promise<any[]> {
  return pathAliases.map(pa => ({
    name: pa.alias,
    path: pa.alias,
    type: "directory",
    // Skip including the actual path to protect privacy
  }));
}

// Modified validatePath to work with aliases
export async function validatePath(requestedPath: string, allowedDirectories: string[] = []): Promise<string> {
  // If we're using aliases and the path isn't absolute, try to resolve it as an alias path
  if (pathAliases.length > 0 && (!path.isAbsolute(requestedPath) || requestedPath.startsWith('~'))) {
    // Special case for root
    if (requestedPath === 'root' || requestedPath === '/') {
      throw new Error("Cannot perform this operation on the filesystem root directly");
    }
    
    try {
      // Convert alias path to absolute path
      const absolutePath = resolveAliasPath(requestedPath);
      
      // Handle symlinks by checking their real path
      try {
        const realPath = await fs.realpath(absolutePath);
        // Verify that the real path is still within our allowed paths
        const normalizedReal = normalizePath(realPath);
        const isRealPathAllowed = pathAliases.some(pa => 
          normalizedReal.startsWith(pa.normalizedPath)
        );
        
        if (!isRealPathAllowed) {
          throw new Error("Access denied - symlink target outside allowed directories");
        }
        return realPath;
      } catch (error) {
        // For new files that don't exist yet, verify parent directory
        const parentDir = path.dirname(absolutePath);
        try {
          const realParentPath = await fs.realpath(parentDir);
          const normalizedParent = normalizePath(realParentPath);
          const isParentAllowed = pathAliases.some(pa => 
            normalizedParent.startsWith(pa.normalizedPath)
          );
          
          if (!isParentAllowed) {
            throw new Error("Access denied - parent directory outside allowed directories");
          }
          return absolutePath;
        } catch {
          throw new Error(`Parent directory does not exist: ${parentDir}`);
        }
      }
    } catch (error) {
      throw new Error(`Invalid alias path: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    // Legacy direct path validation logic (no aliases)
    const expandedPath = expandHome(requestedPath);
    const absolute = path.isAbsolute(expandedPath)
      ? path.resolve(expandedPath)
      : path.resolve(process.cwd(), expandedPath);
      
    const normalizedRequested = normalizePath(absolute);

    // Check if path is within allowed directories
    const isAllowed = allowedDirectories.some(dir => normalizedRequested.startsWith(dir));
    if (!isAllowed) {
      throw new Error(`Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`);
    }

    // Handle symlinks by checking their real path
    try {
      const realPath = await fs.realpath(absolute);
      const normalizedReal = normalizePath(realPath);
      const isRealPathAllowed = allowedDirectories.some(dir => normalizedReal.startsWith(dir));
      if (!isRealPathAllowed) {
        throw new Error("Access denied - symlink target outside allowed directories");
      }
      return realPath;
    } catch (error) {
      // For new files that don't exist yet, verify parent directory
      const parentDir = path.dirname(absolute);
      try {
        const realParentPath = await fs.realpath(parentDir);
        const normalizedParent = normalizePath(realParentPath);
        const isParentAllowed = allowedDirectories.some(dir => normalizedParent.startsWith(dir));
        if (!isParentAllowed) {
          throw new Error("Access denied - parent directory outside allowed directories");
        }
        return absolute;
      } catch {
        throw new Error(`Parent directory does not exist: ${parentDir}`);
      }
    }
  }
} 