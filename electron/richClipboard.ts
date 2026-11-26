// Converts Markdown rewrites into multi-format Windows clipboard HTML (CF_HTML) alongside plain
// text. Plain-text editors ignore HTML Format and paste CF_UNICODETEXT untouched; rich-text
// editors (Word, Docs, Notion, Outlook, Slack, Gmail) paste formatted headings, bold, lists, and
// tables. Unformatted text returns undefined so target editors keep their surrounding style.

const MARKDOWN_SIGNALS = [
  /^[ \t]{0,3}#{1,6}[ \t]+\S/m,
  /(\*\*|__)(?=\S)([^\r\n]*?\S)\1/,
  /(^|[^\w*])\*(?=\S)([^*\r\n]*?\S)\*(?![\w*])/m,
  /~~(?=\S)([^\r\n]*?\S)~~/,
  /`[^`\r\n]+`/,
  /^[ \t]{0,3}(?:```|~~~)/m,
  /^[ \t]*[-*+][ \t]+\S/m,
  /^[ \t]*\d+\.[ \t]+\S/m,
  /^[ \t]*>[ \t]*\S/m,
  /\[[^\]\r\n]+\]\((?:https?:\/\/|mailto:)[^\s)\r\n]+\)/i,
  /^\|?.+\|.+\r?\n[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/m,
  /^[ \t]*(?:[-*_][ \t]*){3,}$/m,
];

export function hasMarkdownFormatting(text: string): boolean {
  return MARKDOWN_SIGNALS.some((re) => re.test(text));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeLinkUrl(url: string): boolean {
  return /^(?:https?:\/\/|mailto:)/i.test(url.trim());
}

function renderInline(raw: string): string {
  const tokens: string[] = [];
  const stash = (html: string) => {
    const idx = tokens.length;
    tokens.push(html);
    return `\u0000T${idx}\u0000`;
  };
  const restore = (s: string) => s.replace(/\u0000T(\d+)\u0000/g, (_m, i: string) => tokens[Number(i)] ?? '');

  // Strip NUL bytes so user text can never collide with placeholder tokens.
  let out = raw.replace(/\u0000/g, '');

  // Extract inline code first so formatting inside backticks stays literal.
  out = out.replace(/`([^`\r\n]+)`/g, (_m, code: string) => stash(`<code>${escapeHtml(code)}</code>`));

  // Extract safe links before emphasis so underscores in URLs are never italicized.
  out = out.replace(/\[([^\]\r\n]+)\]\(([^\s)\r\n]+)\)/g, (full, label: string, url: string) => {
    if (!isSafeLinkUrl(url)) return full;
    return stash(`<a href="${escapeHtml(url.trim())}">${restore(renderInlineFormatting(escapeHtml(label)))}</a>`);
  });

  return restore(renderInlineFormatting(escapeHtml(out)));
}

function renderInlineFormatting(escaped: string): string {
  return escaped
    .replace(/(\*\*|__)(?=\S)([^\r\n]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/~~(?=\S)([^\r\n]*?\S)~~/g, '<del>$1</del>')
    .replace(/(^|[^\w*])\*(?=\S)([^*\r\n]*?\S)\*(?![\w*])/g, '$1<em>$2</em>');
}

const isHeading = (line: string) => /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
const isFence = (line: string) => /^[ \t]{0,3}(```|~~~)/.exec(line);
const isRule = (line: string) => /^[ \t]*(?:[-*_][ \t]*){3,}$/.test(line);
const isQuote = (line: string) => /^[ \t]*>[ \t]?(.*)$/.exec(line);
const isUnorderedItem = (line: string) => /^([ \t]*)[-*+][ \t]+(.+)$/.exec(line);
const isOrderedItem = (line: string) => /^([ \t]*)(\d+)\.[ \t]+(.+)$/.exec(line);
const isTableSeparator = (line: string) => /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/.test(line);

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isBlockStart(lines: string[], i: number): boolean {
  const line = lines[i];
  if (!line.trim()) return true;
  if (isHeading(line) || isFence(line) || isRule(line) || isQuote(line)
    || isUnorderedItem(line) || isOrderedItem(line)) return true;
  if (i + 1 < lines.length && line.includes('|') && isTableSeparator(lines[i + 1])) return true;
  return false;
}

function indentWidth(ws: string): number {
  let width = 0;
  for (const ch of ws) width += ch === '\t' ? 2 : 1;
  return width;
}

function renderList(lines: string[], start: number): { html: string; next: number } {
  interface Frame { tag: 'ul' | 'ol'; indent: number; openLi: boolean }
  const frames: Frame[] = [];
  const parts: string[] = [];

  const closeTopLi = () => {
    const top = frames[frames.length - 1];
    if (top?.openLi) {
      parts.push('</li>');
      top.openLi = false;
    }
  };
  const closeFrame = () => {
    closeTopLi();
    const popped = frames.pop();
    if (popped) parts.push(`</${popped.tag}>`);
  };

  let i = start;
  while (i < lines.length) {
    const u = isUnorderedItem(lines[i]);
    const o = !u ? isOrderedItem(lines[i]) : null;
    if (!u && !o) break;
    const tag: 'ul' | 'ol' = u ? 'ul' : 'ol';
    const indent = indentWidth((u ?? o)![1]);
    const itemText = u ? u[2] : o![3];
    const startNum = o ? Number(o[2]) : 1;

    while (frames.length > 0 && indent < frames[frames.length - 1].indent) {
      closeFrame();
    }
    const top = frames[frames.length - 1];
    if (!top || indent > top.indent) {
      const openTag = tag === 'ol' && startNum !== 1 ? `<ol start="${startNum}">` : `<${tag}>`;
      parts.push(openTag);
      frames.push({ tag, indent, openLi: false });
    } else if (top.tag !== tag) {
      closeFrame();
      const openTag = tag === 'ol' && startNum !== 1 ? `<ol start="${startNum}">` : `<${tag}>`;
      parts.push(openTag);
      frames.push({ tag, indent, openLi: false });
    } else {
      closeTopLi();
    }
    parts.push(`<li>${renderInline(itemText)}`);
    frames[frames.length - 1].openLi = true;
    i += 1;
  }
  while (frames.length > 0) closeFrame();
  return { html: parts.join(''), next: i };
}

function renderBlocks(lines: string[]): string {
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = isFence(line);
    if (fence) {
      const marker = fence[1][0];
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^[ \\t]{0,3}${marker}{3,}[ \\t]*$`).test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = isHeading(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (isRule(line)) {
      blocks.push('<hr>');
      i += 1;
      continue;
    }

    if (i + 1 < lines.length && line.includes('|') && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const headHtml = `<thead><tr>${headers.map((h) => `<th>${renderInline(h)}</th>`).join('')}</tr></thead>`;
      const bodyHtml = rows.length
        ? `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
        : '';
      blocks.push(`<table border="1" cellspacing="0" cellpadding="4">${headHtml}${bodyHtml}</table>`);
      continue;
    }

    if (isQuote(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const q = isQuote(lines[i]);
        if (!q) break;
        quoted.push(q[1]);
        i += 1;
      }
      blocks.push(`<blockquote>${renderBlocks(quoted)}</blockquote>`);
      continue;
    }

    if (isUnorderedItem(line) || isOrderedItem(line)) {
      const list = renderList(lines, i);
      blocks.push(list.html);
      i = list.next;
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length && !isBlockStart(lines, i)) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
  }

  return blocks.join('');
}

const CF_HTML_PREFIX = '<html>\r\n<body>\r\n<!--StartFragment-->';
const CF_HTML_SUFFIX = '<!--EndFragment-->\r\n</body>\r\n</html>';
const CF_HTML_HEADER_TEMPLATE =
  'Version:0.9\r\n'
  + 'StartHTML:0000000000\r\n'
  + 'EndHTML:0000000000\r\n'
  + 'StartFragment:0000000000\r\n'
  + 'EndFragment:0000000000\r\n';

/** Wraps an HTML fragment in the Windows CF_HTML clipboard payload with exact UTF-8 byte offsets. */
export function formatCfHtml(fragmentHtml: string): string {
  const pad = (n: number) => String(n).padStart(10, '0');
  const startHtml = Buffer.byteLength(CF_HTML_HEADER_TEMPLATE, 'utf8');
  const startFragment = startHtml + Buffer.byteLength(CF_HTML_PREFIX, 'utf8');
  const endFragment = startFragment + Buffer.byteLength(fragmentHtml, 'utf8');
  const endHtml = endFragment + Buffer.byteLength(CF_HTML_SUFFIX, 'utf8');
  const header =
    'Version:0.9\r\n'
    + `StartHTML:${pad(startHtml)}\r\n`
    + `EndHTML:${pad(endHtml)}\r\n`
    + `StartFragment:${pad(startFragment)}\r\n`
    + `EndFragment:${pad(endFragment)}\r\n`;
  return header + CF_HTML_PREFIX + fragmentHtml + CF_HTML_SUFFIX;
}

export interface RichClipboardHtml {
  /** HTML fragment for Electron's clipboard.write({ html }). */
  html: string;
  /** Full Windows CF_HTML ("HTML Format") payload for native SetClipboardData. */
  cfHtml: string;
}

/**
 * Renders Markdown to clipboard HTML when the text contains real Markdown formatting. Single-line
 * inline formatting (e.g. "**important**") stays inline without a <p> wrapper so pasting into the
 * middle of an existing paragraph doesn't split the paragraph.
 */
export function markdownToClipboardHtml(markdown: string): RichClipboardHtml | undefined {
  if (!hasMarkdownFormatting(markdown)) return undefined;
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const isSingleInlineLine = lines.length === 1 && !isBlockStart(lines, 0);
  const html = isSingleInlineLine ? renderInline(lines[0]) : renderBlocks(lines);
  if (!html) return undefined;
  return { html, cfHtml: formatCfHtml(html) };
}
