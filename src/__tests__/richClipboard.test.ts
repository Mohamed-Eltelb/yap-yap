import { describe, expect, it } from 'vitest';
import { formatCfHtml, hasMarkdownFormatting, markdownToClipboardHtml } from '../../electron/richClipboard';

describe('Rich clipboard Markdown conversion', () => {
  it('returns undefined for plain text so target editors keep their surrounding style', () => {
    for (const plain of [
      'Could you please send it?',
      'Hello world\nSecond line',
      '2 * 3 = 6 and foo_bar_baz',
      'Version 1.5 is ready.',
      'a - b = c',
    ]) {
      expect(hasMarkdownFormatting(plain)).toBe(false);
      expect(markdownToClipboardHtml(plain)).toBeUndefined();
    }
  });

  it('keeps single-line inline formatting inline without wrapping in <p>', () => {
    const rich = markdownToClipboardHtml('Please review **this section** and `config.json`.');
    expect(rich?.html).toBe('Please review <strong>this section</strong> and <code>config.json</code>.');
  });

  it('renders headings, nested lists, blockquotes, code blocks, links, and tables safely', () => {
    const md = [
      '## Plan',
      '',
      '- First **item**',
      '  - Nested *child*',
      '- See [`API`](https://example.com/a_b) and [bad](javascript:alert(1))',
      '',
      '3. Step three',
      '4. Step four',
      '',
      '> Quoted <script>alert(1)</script>',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| A | ~~old~~ **new** |',
      '',
      '```ts',
      'const x = 1 < 2;',
      '```',
    ].join('\n');

    const rich = markdownToClipboardHtml(md);
    expect(rich).toBeDefined();
    expect(rich!.html).toContain('<h2>Plan</h2>');
    expect(rich!.html).toContain('<ul><li>First <strong>item</strong><ul><li>Nested <em>child</em></li></ul></li><li>See <a href="https://example.com/a_b"><code>API</code></a> and [bad](javascript:alert(1))</li></ul>');
    expect(rich!.html).toContain('<ol start="3"><li>Step three</li><li>Step four</li></ol>');
    expect(rich!.html).toContain('<blockquote><p>Quoted &lt;script&gt;alert(1)&lt;/script&gt;</p></blockquote>');
    expect(rich!.html).toContain('<table border="1" cellspacing="0" cellpadding="4"><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td><del>old</del> <strong>new</strong></td></tr></tbody></table>');
    expect(rich!.html).toContain('<pre><code>const x = 1 &lt; 2;</code></pre>');
  });

  it('computes exact UTF-8 byte offsets for Windows CF_HTML even with multibyte text', () => {
    const fragment = '<strong>مرحبًا 🌍</strong>';
    const cfHtml = formatCfHtml(fragment);
    const bytes = Buffer.from(cfHtml, 'utf8');

    const num = (key: string) => Number(cfHtml.match(new RegExp(`${key}:(\\d{10})`))![1]);
    const startHtml = num('StartHTML');
    const endHtml = num('EndHTML');
    const startFragment = num('StartFragment');
    const endFragment = num('EndFragment');

    expect(bytes.subarray(startHtml, endHtml).toString('utf8')).toBe(
      `<html>\r\n<body>\r\n<!--StartFragment-->${fragment}<!--EndFragment-->\r\n</body>\r\n</html>`,
    );
    expect(bytes.subarray(startFragment, endFragment).toString('utf8')).toBe(fragment);
    expect(endHtml).toBe(bytes.length);
  });
});
