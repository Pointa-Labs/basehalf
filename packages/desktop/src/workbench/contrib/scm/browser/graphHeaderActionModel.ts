export type GraphHeaderActionId = 'refPicker' | 'revealCurrent' | 'refresh' | 'openFullGraph';

export interface GraphHeaderButtonAction {
  readonly id: Exclude<GraphHeaderActionId, 'refPicker'>;
  readonly kind: 'button';
  readonly title: string;
  readonly glyph: string;
  readonly disabled: boolean;
}

export interface GraphHeaderRefPickerAction {
  readonly id: 'refPicker';
  readonly kind: 'refPicker';
  readonly title: string;
  readonly disabled: boolean;
}

export type GraphHeaderAction = GraphHeaderButtonAction | GraphHeaderRefPickerAction;

export interface GraphHeaderActionState {
  readonly busy: boolean;
}

export function graphHeaderActions({ busy }: GraphHeaderActionState): readonly GraphHeaderAction[] {
  return [
    {
      id: 'refPicker',
      kind: 'refPicker',
      title: 'History Item Reference Picker',
      disabled: busy,
    },
    {
      id: 'revealCurrent',
      kind: 'button',
      title: 'Go to Current History Item',
      glyph: 'target',
      disabled: busy,
    },
    {
      id: 'refresh',
      kind: 'button',
      title: 'Refresh',
      glyph: 'refresh',
      disabled: busy,
    },
    {
      id: 'openFullGraph',
      kind: 'button',
      title: 'Open Git Graph',
      glyph: 'screen-full',
      disabled: busy,
    },
  ];
}
