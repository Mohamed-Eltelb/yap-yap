import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function SettingsSubdialog({ title, description, children, onClose, wide }: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  /** Room for longer text, such as a list of sentences. */
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="yy-language-dialog"
      data-wide={wide || undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
    >
      <button type="button" autoFocus aria-label={`Close ${title.toLowerCase()}`} className="yy-language-close" onClick={onClose}>
        <X size={18} />
      </button>
      <header>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
      </header>
      {children}
    </dialog>
  );
}
