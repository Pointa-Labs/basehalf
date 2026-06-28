import type { JSX } from 'react';
import { HistoryRefPickerButton } from './HistoryRefPickerButton.js';
import { type GitScmService, gitScmService } from './gitScmService.js';
import { useScmViewStore } from './scmViewStore.js';

export const GraphRefPicker = ({
  disabled,
  gitService: git = gitScmService,
}: {
  disabled: boolean;
  gitService?: GitScmService;
}): JSX.Element => {
  const filter = useScmViewStore((s) => s.historyFilter);
  const setFilter = useScmViewStore((s) => s.setHistoryFilter);

  return (
    <div style={{ display: 'inline-block' }}>
      <HistoryRefPickerButton
        disabled={disabled}
        filter={filter}
        onFilter={setFilter}
        gitService={git}
        testId="graph-ref-picker"
      />
    </div>
  );
};
