export type TurnReviewStatus = 'pending' | 'kept' | 'reverted' | 'conflict' | 'unsupported' | 'failed';

export type TurnFileAction = 'create' | 'update' | 'delete';

export type TurnSnapshotSummary = {
  id: string;
  conversationId: string;
  backend: string;
  requestMessageId?: string;
  startedAt: number;
  completedAt: number;
  completionSignal: string;
  completionSource?: string;
  reviewStatus: TurnReviewStatus;
  fileCount: number;
  sourceMessageIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type TurnSnapshotFile = {
  id: string;
  turnId: string;
  conversationId: string;
  filePath: string;
  fileName: string;
  action: TurnFileAction;
  beforeExists: boolean;
  afterExists: boolean;
  beforeHash?: string;
  afterHash?: string;
  beforeContent?: string;
  afterContent?: string;
  unifiedDiff: string;
  sourceMessageIds: string[];
  revertSupported: boolean;
  revertError?: string;
  createdAt: number;
  updatedAt: number;
};

export type TurnSnapshot = TurnSnapshotSummary & {
  files: TurnSnapshotFile[];
};

export type TurnSnapshotConflict = {
  filePath: string;
  expectedExists: boolean;
  actualExists: boolean;
  expectedHash?: string;
  actualHash?: string;
};

export type TurnSnapshotKeepResult = {
  success: boolean;
  turnId: string;
  reviewStatus?: TurnReviewStatus;
  snapshot?: TurnSnapshot;
  msg?: string;
};

export type TurnSnapshotRevertResult = {
  success: boolean;
  turnId: string;
  status: 'reverted' | 'conflict' | 'unsupported' | 'failed';
  reviewStatus?: TurnReviewStatus;
  snapshot?: TurnSnapshot;
  conflicts?: TurnSnapshotConflict[];
  msg?: string;
};
