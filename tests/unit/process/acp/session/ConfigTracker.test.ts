/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { ConfigTracker } from '../../../../../src/process/acp/session/ConfigTracker';

describe('ConfigTracker', () => {
  it('starts with null current values', () => {
    const tracker = new ConfigTracker();
    expect(tracker.modelSnapshot().currentModelId).toBeNull();
    expect(tracker.modeSnapshot().currentModeId).toBeNull();
  });

  it('setDesiredModel caches intent', () => {
    const tracker = new ConfigTracker();
    tracker.setDesiredModel('gpt-4');
    expect(tracker.getPendingChanges().model).toBe('gpt-4');
  });

  it('setCurrentModel clears desired (INV-S-11)', () => {
    const tracker = new ConfigTracker();
    tracker.setDesiredModel('gpt-4');
    tracker.setCurrentModel('gpt-4');
    expect(tracker.getPendingChanges().model).toBeNull();
    expect(tracker.modelSnapshot().currentModelId).toBe('gpt-4');
  });

  it('syncFromSessionResult populates available options', () => {
    const tracker = new ConfigTracker();
    tracker.syncFromSessionResult({
      currentModelId: 'claude-3',
      availableModels: [{ modelId: 'claude-3', name: 'Claude 3' }],
      currentModeId: 'code',
      availableModes: [{ id: 'code', name: 'Code' }],
      configOptions: [{ id: 'think', name: 'Think', type: 'boolean' as const, currentValue: true }],
      cwd: '/tmp',
    });
    expect(tracker.modelSnapshot().currentModelId).toBe('claude-3');
    expect(tracker.modeSnapshot().currentModeId).toBe('code');
    expect(tracker.configSnapshot().configOptions).toHaveLength(1);
  });

  it('desired overrides current when both set', () => {
    const tracker = new ConfigTracker();
    tracker.setCurrentModel('claude-3');
    tracker.setDesiredModel('gpt-4');
    expect(tracker.getPendingChanges().model).toBe('gpt-4');
  });

  it('setDesiredMode caches intent', () => {
    const tracker = new ConfigTracker();
    tracker.setDesiredMode('architect');
    expect(tracker.getPendingChanges().mode).toBe('architect');
  });

  it('setDesiredConfigOption caches intent', () => {
    const tracker = new ConfigTracker();
    tracker.setDesiredConfigOption('think', true);
    expect(tracker.getPendingChanges().configOptions).toEqual([{ id: 'think', value: true }]);
  });

  it('clearPending removes all desired values', () => {
    const tracker = new ConfigTracker();
    tracker.setDesiredModel('gpt-4');
    tracker.setDesiredMode('ask');
    tracker.clearPending();
    const pending = tracker.getPendingChanges();
    expect(pending.model).toBeNull();
    expect(pending.mode).toBeNull();
    expect(pending.configOptions).toEqual([]);
  });

  it('syncFromInitializeResult seeds modes advertised at initialize time', () => {
    const ct = new ConfigTracker();
    ct.syncFromInitializeResult({
      currentModeId: 'default',
      availableModes: [
        { id: 'plan', name: 'Plan' },
        { id: 'default', name: 'Default' },
        { id: 'auto-edit', name: 'Auto Edit' },
        { id: 'yolo', name: 'YOLO' },
      ],
    });
    const snapshot = ct.modeSnapshot();
    expect(snapshot.currentModeId).toBe('default');
    expect(snapshot.availableModes.map((m) => m.id)).toEqual(['plan', 'default', 'auto-edit', 'yolo']);
  });

  it('syncFromInitializeResult is a no-op for null / empty modes', () => {
    const ct = new ConfigTracker();
    ct.syncFromInitializeResult(null);
    expect(ct.modeSnapshot().availableModes).toEqual([]);
    ct.syncFromInitializeResult({ availableModes: [] });
    expect(ct.modeSnapshot().availableModes).toEqual([]);
  });

  it('syncFromSessionResult overrides modes seeded by syncFromInitializeResult', () => {
    const ct = new ConfigTracker();
    ct.syncFromInitializeResult({
      availableModes: [
        { id: 'plan', name: 'Plan' },
        { id: 'default', name: 'Default' },
      ],
    });
    ct.syncFromSessionResult({
      availableModes: [{ id: 'code', name: 'Code' }],
      currentModeId: 'code',
      cwd: '/tmp',
    });
    expect(ct.modeSnapshot().availableModes.map((m) => m.id)).toEqual(['code']);
  });
});

describe('ConfigTracker model reconciliation', () => {
  it('normalizes a legacy bare model name to the active provider-qualified model', () => {
    const tracker = new ConfigTracker({ model: 'gpt-5.4' });

    tracker.syncFromSessionResult({
      cwd: 'E:/workspace',
      currentModelId: 'custom:gpt-5.4',
      availableModels: [{ modelId: 'custom:gpt-5.4', name: 'gpt-5.4' }],
    });

    expect(tracker.modelSnapshot()).toEqual({
      currentModelId: 'custom:gpt-5.4',
      availableModels: [{ modelId: 'custom:gpt-5.4', name: 'gpt-5.4' }],
    });
    expect(tracker.getPendingChanges().model).toBeNull();
  });

  it('keeps a desired model change when the exact provider-qualified id is available', () => {
    const tracker = new ConfigTracker({ model: 'custom:gpt-5.4' });

    tracker.syncFromSessionResult({
      cwd: 'E:/workspace',
      currentModelId: 'custom:gpt-4.1',
      availableModels: [
        { modelId: 'custom:gpt-4.1', name: 'gpt-4.1' },
        { modelId: 'custom:gpt-5.4', name: 'gpt-5.4' },
      ],
    });

    expect(tracker.getPendingChanges().model).toBe('custom:gpt-5.4');
  });
});
