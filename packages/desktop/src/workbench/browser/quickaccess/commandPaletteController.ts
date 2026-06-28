import {
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type IQuickPick,
  type IQuickPickItem,
  quickInputService,
} from '../../../platform/quickinput/browser/quickInputService.js';
import { isImeComposing } from '../ui/imeGuard.js';
import {
  type CommandPaletteAction,
  reconcileCommandPaletteSelection,
} from './commandPaletteModel.js';

export const commandPaletteListId = 'bh-command-palette-list';
export const commandPaletteOptionId = (idx: number): string => `bh-command-palette-option-${idx}`;

export interface CommandPaletteController {
  readonly selectedIdx: number;
  readonly mouseActive: boolean;
  readonly activeOptionId?: string;
  readonly cardRef: RefObject<HTMLDivElement | null>;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly listRef: RefObject<HTMLDivElement | null>;
  readonly closePalette: () => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly handleInputChange: (value: string) => void;
  readonly handleMouseMove: () => void;
  readonly handleRowHover: (idx: number, id: string) => void;
  readonly handleRowClick: (action: CommandPaletteAction) => void;
}

interface CommandPaletteQuickPickItem extends IQuickPickItem {
  readonly action: CommandPaletteAction;
}

export function useCommandPaletteController(args: {
  readonly open: boolean;
  readonly initialValue: string;
  readonly query: string;
  readonly rows: readonly CommandPaletteAction[];
  readonly setOpen: (open: boolean) => void;
  readonly setQuery: Dispatch<SetStateAction<string>>;
}): CommandPaletteController {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mouseActive, setMouseActive] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<IQuickPick<CommandPaletteQuickPickItem> | null>(null);
  const previousFocusElementRef = useRef<HTMLElement | null>(null);
  const selectedActionIdRef = useRef<string | null>(null);
  const initialValueRef = useRef(args.initialValue);
  const queryRef = useRef(args.query);
  const quickPickItems = useMemo<readonly CommandPaletteQuickPickItem[]>(
    () => args.rows.map((action) => ({ label: action.label, action })),
    [args.rows],
  );

  const activeOptionId =
    args.rows[selectedIdx] !== undefined ? commandPaletteOptionId(selectedIdx) : undefined;

  const restorePreviousFocus = useCallback(() => {
    const active = document.activeElement;
    const card = cardRef.current;
    const previous = previousFocusElementRef.current;
    previousFocusElementRef.current = null;
    if (!(active instanceof HTMLElement) || !card?.contains(active)) return;
    if (previous?.isConnected) {
      previous.focus({ preventScroll: true });
    }
  }, []);

  const finishClosePalette = useCallback(() => {
    restorePreviousFocus();
    args.setOpen(false);
  }, [args.setOpen, restorePreviousFocus]);

  const closePalette = useCallback(() => {
    const picker = pickerRef.current;
    if (picker?.visible === true) {
      quickInputService.cancel();
      return;
    }
    finishClosePalette();
  }, [finishClosePalette]);

  const runAndClose = useCallback(
    (action: CommandPaletteAction) => {
      quickInputService.quickAccess.accept(queryRef.current);
      closePalette();
      queueMicrotask(action.run);
    },
    [closePalette],
  );

  useEffect(() => {
    queryRef.current = args.query;
  }, [args.query]);

  useEffect(() => {
    initialValueRef.current = args.initialValue;
  });

  useEffect(() => {
    if (!args.open) return;
    const picker = quickInputService.createQuickPick<CommandPaletteQuickPickItem>();
    pickerRef.current = picker;
    const disposeActive = picker.onDidChangeActive((items) => {
      const active = items[0];
      const nextIdx = active === undefined ? 0 : picker.items.indexOf(active);
      if (nextIdx < 0) return;
      selectedActionIdRef.current = active?.action.id ?? null;
      setSelectedIdx(nextIdx);
    });
    const disposeValue = picker.onDidChangeValue((value) => {
      quickInputService.quickAccess.updateValue(value);
      args.setQuery(value);
      selectedActionIdRef.current = null;
      setSelectedIdx(0);
    });
    const disposeAccept = picker.onDidAccept(() => {
      const picked = picker.activeItems[0]?.action;
      if (picked) runAndClose(picked);
    });
    const disposeHide = picker.onDidHide(finishClosePalette);
    const disposeFocus = picker.onDidFocus(() => inputRef.current?.focus());
    previousFocusElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialValue = initialValueRef.current;
    args.setQuery(initialValue);
    picker.value = initialValue;
    setSelectedIdx(0);
    selectedActionIdRef.current = null;
    setMouseActive(false);
    picker.show();
    const frame = requestAnimationFrame(() => quickInputService.focus());
    return () => {
      cancelAnimationFrame(frame);
      disposeActive();
      disposeValue();
      disposeAccept();
      disposeHide();
      disposeFocus();
      if (pickerRef.current === picker) pickerRef.current = null;
      picker.dispose();
    };
  }, [args.open, args.setQuery, finishClosePalette, runAndClose]);

  useEffect(() => {
    const nextIdx = reconcileCommandPaletteSelection(
      args.rows,
      selectedIdx,
      selectedActionIdRef.current,
    );
    if (nextIdx !== selectedIdx) {
      setSelectedIdx(nextIdx);
    }
    selectedActionIdRef.current = args.rows[nextIdx]?.id ?? null;
  }, [args.rows, selectedIdx]);

  useEffect(() => {
    if (!args.open) return;
    const picker = pickerRef.current;
    if (picker === null) return;
    picker.items = quickPickItems;
    const activeItem = quickPickItems[selectedIdx];
    picker.activeItems = activeItem === undefined ? [] : [activeItem];
  }, [args.open, quickPickItems, selectedIdx]);

  useEffect(() => {
    if (!args.open) return;
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-bh-palette-idx="${selectedIdx}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [args.open, selectedIdx]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (isImeComposing(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMouseActive(false);
        quickInputService.navigate(true);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMouseActive(false);
        quickInputService.navigate(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        quickInputService.accept();
      } else if (event.key === 'Tab') {
        event.preventDefault();
      }
    },
    [closePalette],
  );

  const handleInputChange = useCallback(
    (value: string): void => {
      const picker = pickerRef.current;
      if (picker === null) {
        quickInputService.quickAccess.updateValue(value);
        args.setQuery(value);
        selectedActionIdRef.current = null;
        setSelectedIdx(0);
        return;
      }
      picker.value = value;
    },
    [args.setQuery],
  );

  const handleMouseMove = useCallback((): void => {
    if (!mouseActive) setMouseActive(true);
  }, [mouseActive]);

  const handleRowHover = useCallback(
    (idx: number, id: string): void => {
      if (!mouseActive) return;
      selectedActionIdRef.current = id;
      setSelectedIdx(idx);
      const picker = pickerRef.current;
      const item = picker?.items[idx];
      if (picker !== null && item !== undefined) picker.activeItems = [item];
    },
    [mouseActive],
  );

  return {
    selectedIdx,
    mouseActive,
    activeOptionId,
    cardRef,
    inputRef,
    listRef,
    closePalette,
    handleKeyDown,
    handleInputChange,
    handleMouseMove,
    handleRowHover,
    handleRowClick: runAndClose,
  };
}
