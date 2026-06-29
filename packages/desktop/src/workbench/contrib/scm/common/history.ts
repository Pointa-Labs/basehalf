export const SCM_INCOMING_HISTORY_ITEM_ID = 'scm-graph-incoming-changes';
export const SCM_OUTGOING_HISTORY_ITEM_ID = 'scm-graph-outgoing-changes';

export interface ScmHistoryOptions {
  readonly skip?: number;
  readonly limit?: number;
  readonly historyItemRefs?: readonly string[];
  readonly filterText?: string;
}

export interface ScmHistoryItemRef {
  readonly id: string;
  readonly name: string;
  readonly revision?: string;
  readonly category?: 'branch' | 'remote' | 'tag' | 'other';
  readonly description?: string;
  readonly color?: string;
  readonly icon?: string;
}

export interface ScmHistoryItemStatistics {
  readonly files: number;
  readonly insertions?: number;
  readonly deletions?: number;
}

export interface ScmHistoryItem {
  readonly id: string;
  readonly parentIds: readonly string[];
  readonly subject: string;
  readonly message: string;
  readonly displayId?: string;
  readonly author?: string;
  readonly authorEmail?: string;
  readonly timestamp?: number;
  readonly statistics?: ScmHistoryItemStatistics;
  readonly references?: readonly ScmHistoryItemRef[];
}

export interface ScmHistoryItemChange {
  readonly path: string;
  readonly status: string;
  readonly originalPath?: string;
}

export interface ScmCurrentHistoryItemRefs {
  readonly historyItemRef?: ScmHistoryItemRef;
  readonly historyItemRemoteRef?: ScmHistoryItemRef;
  readonly historyItemBaseRef?: ScmHistoryItemRef;
}

export interface ScmHistoryItemRefsChangeEvent {
  readonly added: readonly ScmHistoryItemRef[];
  readonly removed: readonly ScmHistoryItemRef[];
  readonly modified: readonly ScmHistoryItemRef[];
  readonly silent: boolean;
}

export interface ScmHistoryItemGraphNode {
  readonly id: string;
  readonly color: string;
}

export type ScmHistoryItemViewModelKind = 'HEAD' | 'node' | 'incoming-changes' | 'outgoing-changes';

export interface ScmHistoryItemViewModel {
  readonly historyItem: ScmHistoryItem;
  readonly inputSwimlanes: readonly ScmHistoryItemGraphNode[];
  readonly outputSwimlanes: readonly ScmHistoryItemGraphNode[];
  readonly kind: ScmHistoryItemViewModelKind;
}

export interface ScmHistoryProvider {
  readonly historyItemRef?: ScmHistoryItemRef;
  readonly historyItemRemoteRef?: ScmHistoryItemRef;
  readonly historyItemBaseRef?: ScmHistoryItemRef;
  readonly historyItemRefChanges?: ScmHistoryItemRefsChangeEvent;
  provideCurrentHistoryItemRefs(): Promise<ScmCurrentHistoryItemRefs>;
  provideHistoryItemRefs(
    historyItemRefs?: readonly string[],
  ): Promise<readonly ScmHistoryItemRef[]>;
  provideHistoryItems(options: ScmHistoryOptions): Promise<readonly ScmHistoryItem[]>;
  provideHistoryItemChanges(
    historyItemId: string,
    historyItemParentId?: string,
  ): Promise<readonly ScmHistoryItemChange[]>;
  resolveHistoryItem(historyItemId: string): Promise<ScmHistoryItem | undefined>;
  resolveHistoryItemRefsCommonAncestor(
    historyItemRefs: readonly string[],
  ): Promise<string | undefined>;
}
