import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface Props<Value extends string> {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
  className?: string;
  id?: string;
  placeholder?: string;
  quiet?: boolean;
}

export function SelectMenu<Value extends string>({
  label, value, options, onChange, className = '', id, placeholder = 'Select an option', quiet = false,
}: Props<Value>) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useRef({ text: '', time: 0 });
  const selected = options.findIndex((option) => option.value === value);

  useLayoutEffect(() => {
    const anchor = trigger.current;
    const popup = menu.current;
    if (!open || !anchor || !popup) return;

    const position = () => {
      const rect = anchor.getBoundingClientRect();
      if (!anchor.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))) {
        setOpen(false);
        return;
      }
      const above = rect.top - 16;
      const below = window.innerHeight - rect.bottom - 16;
      const placeAbove = above >= Math.min(popup.scrollHeight, 288) || above >= below;
      popup.style.width = `${rect.width}px`;
      popup.style.left = `${rect.left}px`;
      popup.style.maxHeight = `${Math.min(288, placeAbove ? above : below)}px`;
      popup.style.top = placeAbove ? 'auto' : `${rect.bottom + 8}px`;
      popup.style.bottom = placeAbove ? `${window.innerHeight - rect.top + 8}px` : 'auto';
    };
    const dismissOutside = (event: PointerEvent) => {
      if (!anchor.contains(event.target as Node) && !popup.contains(event.target as Node)) setOpen(false);
    };
    const onScroll = (event: Event) => {
      if (event.target !== popup) position();
    };

    popup.showPopover();
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerdown', dismissOutside, true);
    return () => {
      popup.hidePopover();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerdown', dismissOutside, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open) menu.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = (index = Math.max(0, selected)) => {
    search.current = { text: '', time: 0 };
    setActive(index);
    setOpen(true);
  };

  const select = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    if (key === 'Tab') {
      setOpen(false);
      return;
    }
    if (key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (open) select(active);
      else show();
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End') {
      event.preventDefault();
      let index = Math.max(0, selected);
      if (key === 'Home') index = 0;
      if (key === 'End') index = options.length - 1;
      if (open && key === 'ArrowUp') index = Math.max(0, active - 1);
      if (open && key === 'ArrowDown') index = Math.min(options.length - 1, active + 1);
      if (open) setActive(index);
      else show(index);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const prefix = now - search.current.time < 600 ? search.current.text : '';
      const text = prefix + key.toLocaleLowerCase();
      const index = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(text));
      if (index >= 0) {
        event.preventDefault();
        setOpen(true);
        setActive(index);
      }
      search.current = { text: index >= 0 ? text : '', time: now };
    }
  };

  return (
    <div className={`yy-select ${className}`}>
      <button
        id={id}
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        className={`yy-select-trigger${quiet ? ' yy-select-quiet' : ''}`}
        disabled={!options.length}
        onClick={() => open ? setOpen(false) : show()}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      >
        <span>{options[selected]?.label ?? placeholder}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div ref={menu} id={listId} popover="manual" role="listbox" aria-label={label} className="yy-option-menu">
        {options.map((option, index) => (
          <div
            key={option.value}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === selected}
            data-active={open && index === active}
            className="yy-option"
            onPointerMove={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => select(index)}
          >
            <span>{option.label}</span>
            {!quiet && index === selected && <Check size={15} className="yy-option-check" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </div>
  );
}
