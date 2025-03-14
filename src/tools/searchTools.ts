import fs from "fs/promises";
import path from "path";
import glob from "fast-glob"; 
import { z } from "zod";
import { 
  validatePath, 
  pathAliases,
  toAliasPath,
  resolveAliasPath,
  normalizePath
} from "../pathUtils.js";

// Schema definition
export const SearchFilesAndFoldersSchema = z.object({
  pattern: z.string(),
  includeMetadata: z.boolean().optional().default(false),
  ignore: z.array(z.string()).optional(),
  cwd: z.string().optional(),
});

export async function searchFilesAndFolders(parsed: z.infer<typeof SearchFilesAndFoldersSchema>, allowedDirectories: string[]): Promise<any[]> {
  // Default ignore patterns similar to .gitignore
  const defaultIgnore = [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/.DS_Store",
  ];
  
  const ignorePatterns = parsed.ignore || defaultIgnore;
  let searchResults: string[] = [];
  
  // Special case: Root-level listing with "*" pattern
  // This should only return the top-level directories, not recursively search
  if (parsed.pattern === "*" && (!parsed.cwd || parsed.cwd === 'root' || parsed.cwd === '/') && pathAliases.length > 0) {
    console.error("Special case: Root-level listing with '*' pattern");
    
    // Instead of searching, we'll just return the aliases as top-level entries
    const results = pathAliases.map(alias => ({
      path: alias.alias,
      // Always include type
      type: "directory", 
      // Only include these additional fields if metadata was requested
      ...(parsed.includeMetadata ? {
        size: 0,
        created: new Date(),
        modified: new Date(),
      } : {})
    }));
    
    return results;
  }
  
  // Determine if the pattern starts with a specific alias
  const patternParts = parsed.pattern.split(/[\/\\]/, 2);
  const potentialAlias = patternParts[0];
  const hasSpecificAlias = pathAliases.some(pa => pa.alias === potentialAlias);
  
  // Case 1: Pattern starts with a specific alias (e.g., "docs/file.txt")
  if (hasSpecificAlias) {
    // The pattern already contains an alias, resolve it and search
    try {
      // Check if the pattern contains glob wildcards
      const hasGlobWildcards = parsed.pattern.includes('*') || 
                              parsed.pattern.includes('?') || 
                              parsed.pattern.includes('{') || 
                              parsed.pattern.includes('[');
      
      if (hasGlobWildcards) {
        // Extract the alias and get its full path
        const matchingAlias = pathAliases.find(pa => pa.alias === potentialAlias);
        if (matchingAlias) {
          // For patterns like "MyWritings/**/jokes.md", we need to extract everything after the alias
          const aliasWithSlash = potentialAlias + '/';
          const remainingPattern = parsed.pattern.startsWith(aliasWithSlash) 
            ? parsed.pattern.substring(aliasWithSlash.length)
            : '**'; // If just the alias is given, search everything
          
          // Special case for "MyWritings/*" pattern - only list top level
          if (remainingPattern === "*") {
            console.error(`Special case: Top-level listing for "${potentialAlias}/*" pattern`);
            
            try {
              // Get direct children only
              const entries = await fs.readdir(matchingAlias.fullPath, { withFileTypes: true });
              searchResults = entries.map(entry => {
                return path.join(matchingAlias.fullPath, entry.name);
              });
              
              console.error(`Found ${searchResults.length} top-level items in ${matchingAlias.alias}`);
            } catch (error) {
              console.error(`Error reading directory ${matchingAlias.fullPath}:`, error);
            }
          } else {
            // Regular glob pattern search
            console.error(`Searching for glob pattern "${remainingPattern}" in alias ${potentialAlias}`);
            
            // Search with the glob pattern in the alias path
            searchResults = await glob(remainingPattern, {
              cwd: matchingAlias.fullPath,
              ignore: ignorePatterns,
              absolute: true,
              onlyFiles: false,
              dot: true,
            });
            
            console.error(`Found ${searchResults.length} results for "${remainingPattern}" in ${matchingAlias.alias}`);
          }
          
          // If nothing was found but we were looking for a specific file pattern,
          // try checking if the file exists directly (in case glob had issues)
          if (searchResults.length === 0 && !remainingPattern.includes('**')) {
            const directPath = path.join(matchingAlias.fullPath, remainingPattern);
            try {
              await fs.access(directPath);
              const stats = await fs.stat(directPath);
              if (stats.isFile() || stats.isDirectory()) {
                console.error(`Found direct match at ${directPath}`);
                searchResults = [directPath];
              }
            } catch (error) {
              // File doesn't exist directly
              console.error(`No direct match found at ${directPath}`);
            }
          }
        }
      } else {
        // No glob wildcards, treat as a normal path
        const resolvedPath = resolveAliasPath(parsed.pattern);
        
        // If the pattern points to a specific file, just validate and return it
        try {
          const stats = await fs.stat(resolvedPath);
          if (stats.isFile()) {
            searchResults = [resolvedPath];
          } else {
            // It's a directory, so use it as cwd and search with remaining pattern
            const remainingPattern = patternParts.length > 1 ? patternParts.slice(1).join('/') : '**';
            searchResults = await glob(remainingPattern, {
              cwd: resolvedPath,
              ignore: ignorePatterns,
              absolute: true,
              onlyFiles: false,
              dot: true,
            });
          }
        } catch (error) {
          // Path doesn't exist, use the directory part as cwd and rest as pattern
          const dirPart = path.dirname(resolvedPath);
          const filePart = path.basename(parsed.pattern);
          try {
            await fs.access(dirPart);
            searchResults = await glob(filePart, {
              cwd: dirPart,
              ignore: ignorePatterns,
              absolute: true,
              onlyFiles: false,
              dot: true,
            });
          } catch {
            // Even the directory doesn't exist
            console.error(`Neither path nor parent directory exists: ${resolvedPath}`);
          }
        }
      }
    } catch (error) {
      console.error(`Error resolving alias path: ${error}`);
    }
  }
  // Case 2: User specified a cwd
  else if (parsed.cwd) {
    // Skip the special case already handled above
    if ((parsed.cwd === 'root' || parsed.cwd === '/') && parsed.pattern === '*') {
      // This is handled by the special case above, do nothing here
      console.error("Root listing with '*' pattern already handled");
    } else if (parsed.cwd === 'root' || parsed.cwd === '/') {
      throw new Error("Cannot use root as the current working directory for search with patterns other than '*'");
    } else {
      // Resolve the cwd as an aliased path first
      const cwd = await validatePath(parsed.cwd, allowedDirectories);
      
      // Special case for "*" pattern with cwd - only list top level
      if (parsed.pattern === "*") {
        console.error(`Special case: Top-level listing for cwd "${parsed.cwd}" with "*" pattern`);
        
        try {
          // Get direct children only
          const entries = await fs.readdir(cwd, { withFileTypes: true });
          searchResults = entries.map(entry => {
            return path.join(cwd, entry.name);
          });
          
          console.error(`Found ${searchResults.length} top-level items in ${parsed.cwd}`);
        } catch (error) {
          console.error(`Error reading directory ${cwd}:`, error);
        }
      } else {
        // Regular search in the specified cwd
        searchResults = await glob(parsed.pattern, {
          cwd,
          ignore: ignorePatterns,
          absolute: true,
          onlyFiles: false,
          dot: true,
        });
      }
    }
  } 
  // Case 3: No cwd, no specific alias in pattern - search ALL aliases
  else if (pathAliases.length > 0) {
    // Special handling for "*" pattern has already been done at the top of the function
    if (parsed.pattern !== "*") {
      console.error(`Searching pattern "${parsed.pattern}" across all aliases`);
      
      // Search in ALL aliased directories
      for (const alias of pathAliases) {
        try {
          const aliasResults = await glob(parsed.pattern, {
            cwd: alias.fullPath,
            ignore: ignorePatterns,
            absolute: true,
            onlyFiles: false,
            dot: true,
          });
          searchResults = [...searchResults, ...aliasResults];
        } catch (error) {
          console.error(`Error searching in ${alias.alias}:`, error);
        }
      }
    }
  } 
  // Case 4: Legacy mode (no aliases defined)
  else {
    // Fallback to process.cwd() only if not using aliases
    const cwd = process.cwd();
    
    // Special case for "*" pattern - only list top level
    if (parsed.pattern === "*") {
      console.error(`Special case: Top-level listing for current directory with "*" pattern`);
      
      try {
        // Get direct children only
        const entries = await fs.readdir(cwd, { withFileTypes: true });
        searchResults = entries.map(entry => {
          return path.join(cwd, entry.name);
        });
        
        console.error(`Found ${searchResults.length} top-level items in current directory`);
      } catch (error) {
        console.error(`Error reading directory ${cwd}:`, error);
      }
    } else {
      // Regular search in current directory
      searchResults = await glob(parsed.pattern, {
        cwd,
        ignore: ignorePatterns,
        absolute: true,
        onlyFiles: false,
        dot: true,
      });
    }
  }
  
  // Filter out any matches that are outside allowed directories
  // and optionally add metadata
  const results = await Promise.all(
    searchResults.map(async (match) => {
      try {
        // For searches with aliases, we need to check if the match is within an allowed directory
        if (pathAliases.length > 0) {
          const normalizedMatch = normalizePath(match);
          const isAllowed = pathAliases.some(alias => 
            normalizedMatch.startsWith(alias.normalizedPath)
          );
          
          if (!isAllowed) {
            return null; // Skip files outside allowed directories
          }
        } else {
          // For non-alias mode, use validatePath
          await validatePath(match, allowedDirectories);
        }
        
        // Convert to alias path for the response
        const aliasPath = pathAliases.length > 0 ? toAliasPath(match) : match;
        
        // Get file stats - needed for type determination regardless of metadata option
        const stats = await fs.stat(match);
        const fileType = stats.isDirectory() ? "directory" : "file";
        
        if (parsed.includeMetadata) {
          return {
            path: aliasPath,
            type: fileType,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
          };
        } else {
          return { 
            path: aliasPath,
            type: fileType 
          };
        }
      } catch (error) {
        console.error(`Error processing search result ${match}:`, error);
        return null;
      }
    })
  );
  
  // Filter out null values from paths that failed validation
  return results.filter(Boolean);
} 