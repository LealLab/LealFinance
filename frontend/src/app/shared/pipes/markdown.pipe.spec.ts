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

  it('returns an empty string for empty input', () => {
    expect(pipe.transform('')).toBe('');
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });
});
