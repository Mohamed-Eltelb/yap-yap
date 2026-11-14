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
    // A trigger that was just pressed stays quiet until the pointer leaves it.
    let pressed: HTMLElement | null = null;
    // While a modal opened by the pressed trigger is up, the pointer is over the
    // modal, not elsewhere in the app, so keep the trigger quiet until it closes.
    const modalOpen = () => document.querySelector('dialog:modal') !== null;
    const update = () => setTrigger((hovered && hovered !== pressed ? hovered : null) ?? focused);

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const next = tooltipTrigger(event.target);
      if (next === tooltipTrigger(event.relatedTarget)) return;
      hovered = next;
      if (pressed && pressed !== next && !modalOpen()) pressed = null;
      update();
    };
    const onPointerOut = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const next = tooltipTrigger(event.relatedTarget);
      if (next === tooltipTrigger(event.target)) return;
      hovered = next;
      if (pressed && pressed !== next && !modalOpen()) pressed = null;
      update();
    };
    const onPointerDown = (event: PointerEvent) => {
      pressed = tooltipTrigger(event.target) ?? (modalOpen() ? pressed : null);
      focused = null;
      update();
    };
    const onFocusIn = (event: FocusEvent) => {
      const next = tooltipTrigger(event.target);
      // Only keyboard focus shows a tooltip; mouse clicks and focus restored
      // after a modal closes should not leave one stuck on screen.
      focused = next && next !== pressed && next.matches(':focus-visible') ? next : null;
      update();
    };
    const onFocusOut = () => {
      focused = null;
      update();
    };
    const dismiss = () => {
      pressed = hovered ?? (modalOpen() ? pressed : null);
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
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('click', dismiss, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('click', dismiss, true);
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
      const modal = document.querySelector('dialog:modal');
      const coveredByModal = modal !== null && !modal.contains(trigger);
      if (!label || coveredByModal || !trigger.isConnected || !trigger.checkVisibility({ visibilityProperty: true })) {
        tooltip.hidePopover();
        return;
      }

      if (tooltip.textContent !== label) tooltip.textContent = label;
      if (!tooltip.matches(':popover-open')) tooltip.showPopover();

      const anchor = trigger.getBoundingClientRect();
      const { width, height } = tooltip.getBoundingClientRect();
      const gap = 4;
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
      className="yy-personalization-tooltip pointer-events-none fixed inset-auto m-0 w-max max-w-[min(14rem,calc(100vw-8px))] rounded-md px-2 py-1 text-xs leading-snug shadow-md wrap-anywhere"
    />,
    trigger.closest('dialog[open]') ?? document.body,
  );
}
