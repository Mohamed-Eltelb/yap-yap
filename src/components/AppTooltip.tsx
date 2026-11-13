import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function tooltipTrigger(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
}

export function AppTooltip() {
  const id = useId();
  const bubble = useRef<HTMLDivElement>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let hovered: HTMLElement | null = null;
    let focused: HTMLElement | null = null;
    const update = () => setTrigger(hovered ?? focused);

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      hovered = tooltipTrigger(event.target);
      update();
    };
    const onPointerOut = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      hovered = tooltipTrigger(event.relatedTarget);
      update();
    };
    const onFocusIn = (event: FocusEvent) => {
      focused = tooltipTrigger(event.target);
      update();
    };
    const onFocusOut = () => {
      focused = null;
      update();
    };
    const dismiss = () => {
      hovered = null;
      focused = null;
      update();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !bubble.current?.matches(':popover-open')) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', dismiss);
    };
  }, []);

  useLayoutEffect(() => {
    const tooltip = bubble.current;
    if (!trigger || !tooltip) return;

    const description = trigger.getAttribute('aria-describedby');
    const describesTrigger = !trigger.hasAttribute('aria-label') && !trigger.textContent?.includes(trigger.dataset.tooltip ?? '');
    if (describesTrigger) {
      trigger.setAttribute('aria-describedby', description ? `${description} ${id}` : id);
    }

    const updatePosition = () => {
      const label = trigger.dataset.tooltip;
      if (!label || !trigger.isConnected || !trigger.checkVisibility({ visibilityProperty: true })) {
        tooltip.hidePopover();
        return;
      }

      if (tooltip.textContent !== label) tooltip.textContent = label;
      if (!tooltip.matches(':popover-open')) tooltip.showPopover();

      const anchor = trigger.getBoundingClientRect();
      const { width, height } = tooltip.getBoundingClientRect();
      const gap = 6;
      const below = anchor.bottom + gap;
      const above = anchor.top - height - gap;
      const top = below + height <= window.innerHeight - gap ? below : above;
      const left = anchor.left + (anchor.width - width) / 2;
      tooltip.style.top = `${Math.max(gap, Math.min(top, window.innerHeight - height - gap))}px`;
      tooltip.style.left = `${Math.max(gap, Math.min(left, window.innerWidth - width - gap))}px`;
    };

    const observer = new MutationObserver(updatePosition);
    observer.observe(trigger, { attributes: true, attributeFilter: ['data-tooltip'] });
    observer.observe(document.body, { childList: true, subtree: true });
    const dialog = trigger.closest('dialog');
    if (dialog) observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      observer.disconnect();
      tooltip.hidePopover();
      if (describesTrigger) {
        if (description) trigger.setAttribute('aria-describedby', description);
        else trigger.removeAttribute('aria-describedby');
      }
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [id, trigger]);

  if (!trigger) return null;

  return createPortal(
    <div
      ref={bubble}
      id={id}
      role="tooltip"
      popover="manual"
      className="yy-personalization-tooltip pointer-events-none fixed inset-auto m-0 w-max max-w-[min(15rem,calc(100vw-12px))] rounded-lg p-2.5 text-xs leading-relaxed shadow-lg wrap-anywhere"
    />,
    trigger.closest('dialog[open]') ?? document.body,
  );
}
