import type { CSSProperties, JSX } from 'react';
import { color, font, motion, radius, shadow, space } from '../style/design.js';
import { CommandPaletteRow } from './CommandPaletteRow.js';
import {
  type CommandPaletteController,
  commandPaletteListId,
  commandPaletteOptionId,
} from './commandPaletteController.js';
import type { CommandPaletteAction, IMatch } from './commandPaletteModel.js';

const backdropStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: color.backdrop,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: 100,
  zIndex: 100,
  animation: `bh-fade-in ${motion.fast}`,
};

const cardStyle: CSSProperties = {
  background: color.surface,
  borderRadius: radius.xl,
  boxShadow: shadow.floating,
  width: 560,
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'calc(100vh - 200px)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: font.sans,
  animation: `bh-dialog-in ${motion.normal}`,
};

const inputStyle: CSSProperties = {
  border: 'none',
  outline: 'none',
  padding: `${space[3]}px ${space[4]}px`,
  fontSize: font.size.body,
  fontFamily: font.sans,
  color: color.textPrimary,
  background: 'transparent',
  borderBottom: `1px solid ${color.divider}`,
};

const listStyle: CSSProperties = {
  overflowY: 'auto',
  flex: 1,
  padding: space[1],
};

const emptyStyle: CSSProperties = {
  padding: `${space[5]}px ${space[4]}px`,
  textAlign: 'center',
  color: color.textTertiary,
  fontSize: font.size.caption,
};

export function CommandPaletteView({
  controller,
  filterValue,
  inputValue,
  matchMap,
  placeholder,
  rows,
}: {
  readonly controller: CommandPaletteController;
  readonly filterValue: string;
  readonly inputValue: string;
  readonly matchMap: Map<string, IMatch[]>;
  readonly placeholder?: string;
  readonly rows: readonly CommandPaletteAction[];
}): JSX.Element {
  return (
    <div
      style={backdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) controller.closePalette();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        ref={controller.cardRef}
        style={cardStyle}
        onKeyDown={controller.handleKeyDown}
        onMouseMove={controller.handleMouseMove}
      >
        <input
          ref={controller.inputRef}
          type="text"
          value={inputValue}
          onChange={(event) => controller.handleInputChange(event.target.value)}
          placeholder={placeholder ?? 'Switch workspace, open a file, run an action...'}
          style={inputStyle}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={commandPaletteListId}
          aria-expanded="true"
          aria-activedescendant={controller.activeOptionId}
          aria-label="Command palette"
          data-testid="command-palette-input"
        />
        <div
          id={commandPaletteListId}
          ref={controller.listRef}
          style={listStyle}
          role="listbox"
          aria-label="Results"
        >
          {rows.length === 0 ? (
            <div style={emptyStyle} role="status">
              No matches for "{filterValue || inputValue}"
            </div>
          ) : (
            rows.map((action, idx) => (
              <CommandPaletteRow
                key={action.id}
                id={commandPaletteOptionId(idx)}
                action={action}
                idx={idx}
                selected={idx === controller.selectedIdx}
                query={filterValue.trim()}
                labelMatches={matchMap.get(action.id)}
                onHover={() => controller.handleRowHover(idx, action.id)}
                onClick={() => controller.handleRowClick(action)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
