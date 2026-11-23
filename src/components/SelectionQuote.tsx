import { useLayoutEffect, useRef, useState } from 'react';

/** The text an Ask anything question was about, under the question. Long text folds to two lines. */
export function SelectionQuote({ text, className = '' }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element && !open) setLong(element.scrollHeight > element.clientHeight + 1);
  }, [text, open]);

  return (
    <div className={`yy-selection-quote ${className}`}>
      <p ref={ref} dir="auto" data-open={open || undefined} aria-label="Selected text">{text}</p>
      {(long || open) && (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
