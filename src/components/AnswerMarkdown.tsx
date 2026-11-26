import Markdown from 'react-markdown';

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

/**
 * Converts raw HTML nodes into literal text so HTML/XML snippets and type generics
 * (e.g. `<html lang="ar">`, `Array<string>`) stay visible instead of being stripped,
 * while never injecting raw HTML into the DOM.
 */
function rawHtmlAsText() {
  return (tree: MdastNode) => {
    const visit = (node: MdastNode, isBlockContainer: boolean) => {
      if (!node.children) return;
      for (let i = 0; i < node.children.length; i += 1) {
        const child = node.children[i];
        if (child.type === 'html') {
          const textNode: MdastNode = { type: 'text', value: child.value ?? '' };
          node.children[i] = isBlockContainer
            ? { type: 'paragraph', children: [textNode] }
            : textNode;
        } else {
          visit(child, child.type === 'blockquote' || child.type === 'listItem');
        }
      }
    };
    visit(tree, true);
  };
}

const remarkPlugins = [rawHtmlAsText];

interface Props {
  text?: string;
  className: string;
}

export function AnswerMarkdown({ text, className }: Props) {
  return (
    <div dir="auto" className={`yy-answer-markdown ${className}`}>
      <Markdown remarkPlugins={remarkPlugins} disallowedElements={['a', 'img']} unwrapDisallowed>
        {text}
      </Markdown>
    </div>
  );
}
