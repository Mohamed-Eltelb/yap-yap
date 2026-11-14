import Markdown from 'react-markdown';

interface Props {
  text?: string;
  className: string;
}

export function AnswerMarkdown({ text, className }: Props) {
  return (
    <div dir="auto" className={`yy-answer-markdown ${className}`}>
      <Markdown skipHtml disallowedElements={['a', 'img']} unwrapDisallowed>
        {text}
      </Markdown>
    </div>
  );
}
