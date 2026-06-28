import type { JSX } from 'react';
import { color, font, radius, space } from '../../../browser/style/design.js';
import type { ScmHistoryItemChange } from '../common/history.js';
import { historyStatusTone } from './historyGraphModel.js';
import { historyItemChangeDisplayPath, historyItemChangeKey } from './historyItemChangesModel.js';

export const HistoryItemChangeList = ({
  files,
  paddingX,
  messagePaddingX = paddingX,
  rowHeight = 22,
  rowPaddingY = 0,
  empty,
  loading,
  getLabel = (file) => historyItemChangeDisplayPath(file),
  onOpenFile,
}: {
  readonly files: readonly ScmHistoryItemChange[] | null;
  readonly paddingX: number;
  readonly messagePaddingX?: number;
  readonly rowHeight?: number;
  readonly rowPaddingY?: number;
  readonly empty?: string;
  readonly loading: string;
  readonly getLabel?: (file: ScmHistoryItemChange) => string;
  readonly onOpenFile: (file: ScmHistoryItemChange) => void;
}): JSX.Element => {
  if (files === null) {
    return (
      <HistoryItemChangeMessage paddingX={messagePaddingX}>{loading}</HistoryItemChangeMessage>
    );
  }
  if (files.length === 0 && empty !== undefined) {
    return <HistoryItemChangeMessage paddingX={messagePaddingX}>{empty}</HistoryItemChangeMessage>;
  }
  return (
    <>
      {files.map((file) => {
        const displayPath = historyItemChangeDisplayPath(file);
        const label = getLabel(file);
        return (
          <button
            key={historyItemChangeKey(file)}
            type="button"
            onClick={() => onOpenFile(file)}
            title={displayPath}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space[2],
              width: '100%',
              height: rowHeight,
              padding: `${rowPaddingY}px ${paddingX}px`,
              background: 'none',
              border: 'none',
              borderRadius: radius.sm,
              cursor: 'pointer',
              textAlign: 'left',
              color: color.textSecondary,
              fontFamily: font.sans,
              fontSize: font.size.micro,
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = color.divider;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'none';
            }}
          >
            <span
              style={{
                width: 12,
                flexShrink: 0,
                textAlign: 'center',
                fontFamily: font.mono,
                fontWeight: font.weight.semibold,
                color: historyStatusTone(file.status),
              }}
            >
              {file.status}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label}
            </span>
          </button>
        );
      })}
    </>
  );
};

const HistoryItemChangeMessage = ({
  children,
  paddingX,
}: {
  readonly children: string;
  readonly paddingX: number;
}): JSX.Element => (
  <div
    style={{
      padding: `0 ${paddingX}px`,
      color: color.textTertiary,
      fontFamily: font.sans,
      fontSize: font.size.micro,
    }}
  >
    {children}
  </div>
);
