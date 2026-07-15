import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useModalDrawer(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const backgroundElements = Array.from(dialog.parentElement?.children ?? []).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== dialog,
    );
    const previousInertState = backgroundElements.map(
      (element) => [element, element.hasAttribute('inert')] as const,
    );
    const focusableElements = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hasAttribute('disabled'),
      );

    document.body.style.overflow = 'hidden';
    for (const element of backgroundElements) {
      element.setAttribute('inert', '');
    }
    focusableElements()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }

      const elements = focusableElements();
      const first = elements[0];
      const last = elements.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      for (const [element, wasInert] of previousInertState) {
        if (!wasInert) {
          element.removeAttribute('inert');
        }
      }
      (triggerRef.current ?? previouslyFocused)?.focus();
    };
  }, [open, setOpen]);

  return { dialogRef, triggerRef };
}
