import type {
  TurnLifecycleStatus,
  TurnReviewStatus,
  TurnSnapshot,
  TurnSnapshotFile,
} from '@/common/types/turnSnapshot';
import { parseDiff, type FileChangeInfo } from '@/renderer/utils/file/diffUtils';

export type TurnSummaryLifecycleTone = 'arcoblue' | 'green' | 'orange';
export type TurnSummaryReviewTone = 'green' | 'arcoblue' | 'red' | 'orange';

export const canKeepTurnSnapshot = (snapshot?: TurnSnapshot): boolean =>
  !!snapshot &&
  snapshot.lifecycleStatus !== 'running' &&
  (snapshot.reviewStatus === 'pending' || snapshot.reviewStatus === 'unsupported');

export const canRevertTurnSnapshot = (snapshot?: TurnSnapshot): boolean =>
  !!snapshot && snapshot.lifecycleStatus !== 'running' && snapshot.reviewStatus === 'pending';

export const getLifecycleTone = (status: TurnLifecycleStatus): TurnSummaryLifecycleTone => {
  switch (status) {
    case 'completed':
      return 'green';
    case 'interrupted':
      return 'orange';
    case 'running':
    default:
      return 'arcoblue';
  }
};

export const getReviewTone = (status: Exclude<TurnReviewStatus, 'pending'>): TurnSummaryReviewTone => {
  switch (status) {
    case 'kept':
      return 'green';
    case 'reverted':
      return 'arcoblue';
    case 'unsupported':
      return 'orange';
    case 'conflict':
    case 'failed':
    default:
      return 'red';
  }
};

export const getDescriptionKey = (snapshot: TurnSnapshot): string => {
  if (snapshot.lifecycleStatus === 'running') {
    return 'conversation.turnSummary.description.running';
  }

  switch (snapshot.reviewStatus) {
    case 'kept':
      return snapshot.autoKeptAt
        ? 'conversation.turnSummary.description.autoKept'
        : 'conversation.turnSummary.description.kept';
    case 'reverted':
      return 'conversation.turnSummary.description.reverted';
    case 'conflict':
      return 'conversation.turnSummary.description.conflict';
    case 'unsupported':
      return 'conversation.turnSummary.description.unsupported';
    case 'failed':
      return 'conversation.turnSummary.description.failed';
    case 'pending':
    default:
      return snapshot.lifecycleStatus === 'interrupted'
        ? 'conversation.turnSummary.description.interrupted'
        : 'conversation.turnSummary.description.pending';
  }
};

export const getReviewKey = (status: Exclude<TurnReviewStatus, 'pending'>): string => {
  switch (status) {
    case 'kept':
      return 'messages.turnSnapshot.kept';
    case 'reverted':
      return 'messages.turnSnapshot.reverted';
    case 'conflict':
      return 'messages.turnSnapshot.conflict';
    case 'unsupported':
      return 'messages.turnSnapshot.unsupported';
    case 'failed':
    default:
      return 'messages.turnSnapshot.revertFailed';
  }
};

export const getDefaultExpanded = (status: TurnLifecycleStatus): boolean => status === 'running';

export const toFileChangeInfo = (file: TurnSnapshotFile): FileChangeInfo => {
  const parsedDiff = parseDiff(file.unifiedDiff, file.filePath);

  return {
    fileName: file.fileName || parsedDiff.fileName,
    fullPath: file.filePath,
    insertions: parsedDiff.insertions,
    deletions: parsedDiff.deletions,
    diff: file.unifiedDiff,
  };
};
