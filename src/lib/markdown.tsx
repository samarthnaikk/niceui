import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';

marked.setOptions({ gfm: true, breaks: true });

const TOKEN = /@@MATH(\d+)@@/g;

/** Markdown with KaTeX, sanitized before the trusted formula HTML goes back in. */
export function renderMarkdown(text: string): string {
  const formulas: string[] = [];
  const keep = (tex: string, display: boolean) => {
    const index = formulas.push(katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
    })) - 1;
    return `@@MATH${index}@@`;
  };

  const source = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => keep(tex, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => keep(tex, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => keep(tex, false))
    .replace(/\$([^$\n]+?)\$/g, (_, tex: string) => keep(tex, false));

  const html = marked.parse(source) as string;
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });
  return clean.replace(TOKEN, (_, index: string) => formulas[Number(index)] ?? '');
}

export function Markdown({ text }: { text: string }) {
  return <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}
