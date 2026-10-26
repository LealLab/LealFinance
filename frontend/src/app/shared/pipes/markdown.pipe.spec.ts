import { MarkdownPipe } from './markdown.pipe';

describe('MarkdownPipe', () => {
  const pipe = new MarkdownPipe();

  it('renders emphasis, lists and inline code', () => {
    const html = pipe.transform('Use **bold** and `code`\n\n1. one\n2. two');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<ol');
    expect(html).toContain('<li>one</li>');
  });

  it('turns a single newline into a line break', () => {
    expect(pipe.transform('line one\nline two')).toContain('<br>');
  });

  it('adds a copy button to code blocks when a label is provided', () => {
    const html = pipe.transform('```text\nhello\n```', 'Copy');

    expect(html).toContain(
      'role="button" tabindex="0" class="md-code-copy" aria-label="Copy" title="Copy"></span>',
    );
    expect(html).toContain('<code class="language-text">hello');
    expect(pipe.transform('```text\nhello\n```')).not.toContain('md-code-copy');
  });

  it('renders a markdown image as its alt text, never an <img> that loads a URL', () => {
    const html = pipe.transform('Look: ![balance chart](https://evil.example/?d=12345)');

    expect(html).not.toContain('<img');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('balance chart');
  });

  it('shows raw HTML as text so a literal <img> cannot bypass the image rule', () => {
    const html = pipe.transform('<img src="https://evil.example/?d=1" onerror="x()">hi');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('opens links in a new tab without leaking the opener', () => {
    const html = pipe.transform('See [the docs](https://example.com/page "Docs") and https://example.org');

    expect(html).toContain(
      '<a target="_blank" rel="noopener noreferrer" href="https://example.com/page" title="Docs">the docs</a>',
    );
    expect(html).toContain('href="https://example.org"');
    expect(html.match(/rel="noopener noreferrer"/g)?.length).toBe(2);
  });

  it('returns an empty string for empty input', () => {
    expect(pipe.transform('')).toBe('');
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });
});
