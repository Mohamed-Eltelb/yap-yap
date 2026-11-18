/**
 * An Ask answer as plain text for the clipboard. The answer card renders Markdown, but pasted
 * text should not carry its symbols: "**$5**" pastes as "$5", "## Steps" as "Steps", "* item"
 * as "- item". Line breaks, "-" and "1." lists, and the words themselves stay as they are.
 */
export function answerAsPlainText(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^\s*(```|~~~)/.test(line))
    .filter((line) => !/^\s*([-*_])(\s*\1){2,}\s*$/.test(line))
    .map((line) => line
      .replace(/^(\s*)#{1,6}\s+/, '$1')
      .replace(/^(\s*)>\s?/, '$1')
      .replace(/^(\s*)[*+]\s+/, '$1- '))
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
    .trim();
}
