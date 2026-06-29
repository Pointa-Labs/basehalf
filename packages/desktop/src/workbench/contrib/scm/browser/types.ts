export interface RowAction {
  label: string;
  glyph: string;
  onClick: () => void;
  danger?: boolean;
}
