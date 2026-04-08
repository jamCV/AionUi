import type { TurnReviewStatus, TurnSnapshot, TurnSnapshotFile } from '@/common/types/turnSnapshot';
import { parseDiff, type FileChangeInfo } from '@/renderer/utils/file/diffUtils';

export type TurnSummaryReviewTone = 'arcoblue' | 'green' | 'orange' | 'red';

export const canKeepTurnSnapshot = (snapshot?: TurnSnapshot): boolean =>
  !!snapshot && (snapshot.reviewStatus === 'pending' || snapshot.reviewStatus === 'unsupported');

export const canRevertTurnSnapshot = (snapshot?: TurnSnapshot): boolean =>
  !!snapshot && snapshot.reviewStatus === 'pending';

export const getReviewTone = (status: TurnReviewStatus): TurnSummaryReviewTone => {
  switch (status) {
    case 'kept':
      return 'green';
    case 'reverted':
      return 'arcoblue';
    case 'unsupported':
      return 'orange';
    case 'conflict':
    case 'failed':
      return 'red';
    case 'pending':
    default:
      return 'arcoblue';
  }
};

export const getReviewKey = (status: TurnReviewStatus): string => {
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
      return 'messages.turnSnapshot.failed';
    case 'pending':
    default:
      return 'messages.turnSnapshot.pending';
  }
};

export const getDescriptionKey = (status: TurnReviewStatus): string => {
  switch (status) {
    case 'kept':
      return 'conversation.turnSummary.description.kept';
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
      return 'conversation.turnSummary.description.pending';
  }
};

export const getDefaultExpanded = (status: TurnReviewStatus): boolean =>
  status === 'pending' || status === 'unsupported';

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
