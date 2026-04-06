/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { joinPath } from '@/common/chat/chatLib';
import type { PreviewContentType } from '@/common/types/preview';
import type { PreviewMetadata } from '@/renderer/pages/conversation/Preview';

const isAbsolutePath = (value?: string): boolean => {
  if (!value) return false;
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
};

interface ResolvePreviewTargetOptions {
  workspace?: string;
  relativePath?: string;
  originalPath?: string;
  fileName?: string;
  title?: string;
  contentType: PreviewContentType;
  language?: string;
}

interface ResolvedPreviewTarget {
  absolutePath?: string;
  resolvedPath?: string;
  fileName: string;
  title: string;
  metadata: PreviewMetadata;
}

export const resolvePreviewTarget = ({
  workspace,
  relativePath,
  originalPath,
  fileName,
  title,
  contentType,
  language,
}: ResolvePreviewTargetOptions): ResolvedPreviewTarget => {
  const normalizedRelativePath = isAbsolutePath(relativePath) ? undefined : relativePath;
  const normalizedOriginalPath = isAbsolutePath(originalPath) ? originalPath : undefined;
  const absolutePath = normalizedOriginalPath || (workspace && normalizedRelativePath ? joinPath(workspace, normalizedRelativePath) : undefined);
  const resolvedPath = absolutePath || normalizedOriginalPath || relativePath || originalPath || undefined;

  const computedFileName =
    fileName ||
    (resolvedPath ? resolvedPath.split(/[\\/]/).pop() || resolvedPath : undefined) ||
    contentType.toUpperCase();

  const previewTitle = title || computedFileName || normalizedRelativePath || contentType.toUpperCase();

  const metadata: PreviewMetadata = {
    title: previewTitle,
    fileName: computedFileName,
    filePath: resolvedPath,
    workspace,
    language,
  };

  return {
    absolutePath,
    resolvedPath,
    fileName: computedFileName,
    title: previewTitle,
    metadata,
  };
};

export type { ResolvePreviewTargetOptions, ResolvedPreviewTarget };
