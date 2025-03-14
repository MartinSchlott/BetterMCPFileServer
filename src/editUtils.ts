import fs from "fs/promises";

// Helper function to normalize line endings
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

// Helper function to create unified diff
export function createUnifiedDiff(oldText: string, newText: string, filePath: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  
  let output = `--- ${filePath}\n+++ ${filePath}\n`;
  
  let lineNumber = 1;
  let inDiffBlock = false;
  let diffBlockStart = 0;
  let diffLines: string[] = [];
  
  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : null;
    const newLine = i < newLines.length ? newLines[i] : null;
    
    if (oldLine !== newLine) {
      if (!inDiffBlock) {
        inDiffBlock = true;
        diffBlockStart = lineNumber;
        // Add context lines before diff (up to 3)
        const contextStart = Math.max(0, i - 3);
        for (let j = contextStart; j < i; j++) {
          if (j < oldLines.length) {
            diffLines.push(` ${oldLines[j]}`);
          }
        }
      }
      
      if (oldLine !== null && newLine !== null) {
        // Changed line
        diffLines.push(`-${oldLine}`);
        diffLines.push(`+${newLine}`);
      } else if (oldLine !== null) {
        // Removed line
        diffLines.push(`-${oldLine}`);
      } else if (newLine !== null) {
        // Added line
        diffLines.push(`+${newLine}`);
      }
    } else if (inDiffBlock) {
      // Add context lines after diff (up to 3)
      diffLines.push(` ${oldLine}`);
      
      if (diffLines.length >= 6 || i === Math.max(oldLines.length, newLines.length) - 1) {
        // Output the diff block
        const contextLines = Math.min(3, diffLines.filter(line => line.startsWith(' ')).length);
        const changedLines = diffLines.length - contextLines;
        output += `@@ -${diffBlockStart},${changedLines} +${diffBlockStart},${changedLines} @@\n`;
        output += diffLines.join('\n') + '\n';
        
        inDiffBlock = false;
        diffLines = [];
      }
    }
    
    lineNumber++;
  }
  
  // Output any remaining diff block
  if (inDiffBlock && diffLines.length > 0) {
    const contextLines = Math.min(3, diffLines.filter(line => line.startsWith(' ')).length);
    const changedLines = diffLines.length - contextLines;
    output += `@@ -${diffBlockStart},${changedLines} +${diffBlockStart},${changedLines} @@\n`;
    output += diffLines.join('\n') + '\n';
  }
  
  return output;
}

// Function to apply edits to a file
export async function applyFileEdits(
  filePath: string,
  edits: Array<{oldText: string, newText: string}>,
  dryRun = false
): Promise<string> {
  // Read file content and normalize line endings
  const content = normalizeLineEndings(await fs.readFile(filePath, 'utf-8'));
  
  // Apply edits sequentially
  let modifiedContent = content;
  for (const edit of edits) {
    const normalizedOld = normalizeLineEndings(edit.oldText);
    const normalizedNew = normalizeLineEndings(edit.newText);
    
    // If exact match exists, use it
    if (modifiedContent.includes(normalizedOld)) {
      modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
      continue;
    }
    
    // Otherwise, try line-by-line matching with flexibility for whitespace
    const oldLines = normalizedOld.split('\n');
    const contentLines = modifiedContent.split('\n');
    let matchFound = false;
    
    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const potentialMatch = contentLines.slice(i, i + oldLines.length);
      
      // Compare lines with normalized whitespace
      const isMatch = oldLines.every((oldLine, j) => {
        const contentLine = potentialMatch[j];
        return oldLine.trim() === contentLine.trim();
      });
      
      if (isMatch) {
        // Preserve original indentation of first line
        const originalIndent = contentLines[i].match(/^\s*/)?.[0] || '';
        const newLines = normalizedNew.split('\n').map((line, j) => {
          if (j === 0) return originalIndent + line.trimStart();
          
          // For subsequent lines, try to preserve relative indentation
          const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || '';
          const newIndent = line.match(/^\s*/)?.[0] || '';
          if (oldIndent && newIndent) {
            const relativeIndent = newIndent.length - oldIndent.length;
            return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart();
          }
          return line;
        });
        
        contentLines.splice(i, oldLines.length, ...newLines);
        modifiedContent = contentLines.join('\n');
        matchFound = true;
        break;
      }
    }
    
    if (!matchFound) {
      throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
    }
  }
  
  // Create unified diff
  const diff = createUnifiedDiff(content, modifiedContent, filePath);
  
  // Format diff with appropriate number of backticks
  let numBackticks = 3;
  while (diff.includes('`'.repeat(numBackticks))) {
    numBackticks++;
  }
  const formattedDiff = `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`;
  
  if (!dryRun) {
    await fs.writeFile(filePath, modifiedContent, 'utf-8');
  }
  
  return formattedDiff;
} 