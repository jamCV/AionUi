/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { conversationServiceSingleton } from '@process/services/conversationServiceSingleton';
import { SqliteConversationRepository } from '@process/services/database/SqliteConversationRepository';
import { SqliteTeamRepository } from '@process/services/database/SqliteTeamRepository';
import { workerTaskManager } from '@process/task/workerTaskManagerSingleton';
import { AssistantCatalogService } from './AssistantCatalogService';
import { TeamCommandDetector } from './TeamCommandDetector';
import { TeamOrchestratorService } from './TeamOrchestratorService';
import { registerTeamTurnCompletionHandler } from './teamRuntimeHooks';

const conversationRepo = new SqliteConversationRepository();
const teamRepo = new SqliteTeamRepository();
const commandDetector = new TeamCommandDetector();
const assistantCatalogService = new AssistantCatalogService();

export const teamOrchestratorService = new TeamOrchestratorService(
  teamRepo,
  conversationRepo,
  conversationServiceSingleton,
  workerTaskManager,
  commandDetector,
  assistantCatalogService
);

registerTeamTurnCompletionHandler(async (event) => {
  await teamOrchestratorService.handleConversationTurnCompleted(event);
});
