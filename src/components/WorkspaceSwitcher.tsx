'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Globe } from 'lucide-react';
import type { Client } from '@/lib/supabase/types';

/**
 * Workspace switcher for operators who move between client sites.
 *
 * Replaces a native `<select>`, which had two problems: the browser draws its
 * own arrow next to the one in the markup (two chevrons), and its popup is an
 * OS menu that ignores the product's own surface, radius, spacing and blue —
 * the one control an operator uses constantly looked like nothing else here.
 *
 * ## Why a portal rather than `position: absolute`
 *
 * `.sidebar` is `overflow-y: auto`, so an absolutely positioned panel is
 * clipped at its edge. `position: fixed` looks like the fix but isn't: under
 * the mobile breakpoint `.sidebar` is moved with `transform`, and a
 * transformed ancestor becomes the containing block for fixed descendants —
 * the panel would be trapped and clipped again, on exactly the viewport where
 * it's hardest to notice. Rendering into `document.body` sidesteps both, at
 * the cost of positioning by hand against the trigger's rect.
 */

type Props = {
  clients: Client[];
  selectedClientId: string | null;
  clientName: string;
  onSelect: (id: string) => void;
};

type Rect = { top: number; left: number; width: number; openUp: boolean };

const GAP = 6;
/** Above `.sidebar` (50), below `.dialog-backdrop` (200). */
const MENU_Z = 60;
const MAX_MENU_HEIGHT = 320;

export function WorkspaceSwitcher({ clients, selectedClientId, clientName, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  // Which row the keyboard is on. Kept separate from the selected client:
  // arrowing through the list previews rows without switching workspace.
  const [activeIndex, setActiveIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = Math.max(0, clients.findIndex((client) => client.id === selectedClientId));

  const position = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const box = trigger.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - GAP;
    // Flip above the trigger only when there genuinely isn't room below, so
    // the menu doesn't jump sides on a viewport that's merely snug.
    const openUp = below < Math.min(MAX_MENU_HEIGHT, clients.length * 40 + 12) && box.top > below;

    setRect({
      top: openUp ? box.top - GAP : box.bottom + GAP,
      left: box.left,
      width: box.width,
      openUp,
    });
  }, [clients.length]);

  // Before paint, so the panel never renders at a stale position for a frame.
  useLayoutEffect(() => {
    if (open) position();
  }, [open, position]);

  useEffect(() => {
    if (!open) return;

    // `true` so scrolling inside the sidebar re-anchors it, not just the window.
    const reposition = () => position();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, position]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAt(selectedIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(clients.length - 1);
    }
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % clients.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + clients.length) % clients.length);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(clients.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        // Let focus leave naturally rather than trapping it — this is a menu,
        // not a dialog.
        close(false);
        break;
      default:
        break;
    }
  }

  function choose(id: string) {
    close();
    if (id !== selectedClientId) onSelect(id);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`workspace-switcher ws-trigger${open ? ' ws-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Workspace: ${clientName}. Switch website workspace`}
        onClick={() => (open ? close(false) : openAt(selectedIndex))}
        onKeyDown={onTriggerKeyDown}
      >
        <Globe size={15} aria-hidden="true" />
        <span className="ws-name">{clientName}</span>
        <ChevronDown size={14} className="ws-chevron" aria-hidden="true" />
      </button>

      {open && rect && createPortal(
        <div
          ref={menuRef}
          className={`ws-menu${rect.openUp ? ' ws-menu-up' : ''}`}
          style={{
            top: rect.top,
            left: rect.left,
            minWidth: rect.width,
            zIndex: MENU_Z,
            ...(rect.openUp ? { transform: 'translateY(-100%)' } : null),
          }}
          role="listbox"
          aria-label="Website workspaces"
          aria-activedescendant={`ws-option-${activeIndex}`}
          onKeyDown={onMenuKeyDown}
        >
          {clients.map((client, index) => {
            const isSelected = client.id === selectedClientId;
            return (
              <button
                key={client.id}
                id={`ws-option-${index}`}
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={index === activeIndex ? 0 : -1}
                className={`ws-option${isSelected ? ' ws-option-selected' : ''}`}
                onClick={() => choose(client.id)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="ws-option-name">{client.name}</span>
                {/* Selection is carried by the check, not colour alone. */}
                {isSelected && <Check size={14} aria-hidden="true" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
