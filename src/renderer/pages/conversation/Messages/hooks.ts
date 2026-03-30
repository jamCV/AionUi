/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import { composeMessage } from '@/common/chat/chatLib';
import type { IConversationMessageLocation } from '@/common/types/database';
import { useConversationContext, useConversationContextSafe } from '@renderer/hooks/context/ConversationContext';
import { Fragment, createElement, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { FC, PropsWithChildren } from 'react';

const MESSAGE_PAGE_SIZE = 50;
const MAX_RETAINED_CONVERSATIONS = 5;

type ConversationMessagesSnapshot = {
  items: TMessage[];
  total: number;
  pageSize: number;
  loadedPages: number[];
  oldestLoadedPage: number | null;
  latestLoadedPage: number | null;
  hasOlder: boolean;
  hydrated: boolean;
  isInitialLoading: boolean;
  isLoadingOlder: boolean;
};

type ConversationMessagesEntry = {
  snapshot: ConversationMessagesSnapshot;
  listeners: Set<() => void>;
  lastAccessedAt: number;
  initialLoadPromise?: Promise<void>;
  olderLoadPromise?: Promise<void>;
};

type MessageListUpdater = TMessage[] | ((value: TMessage[]) => TMessage[]);

type MessageIndex = {
  msgIdIndex: Map<string, number>;
  callIdIndex: Map<string, number>;
  toolCallIdIndex: Map<string, number>;
};

const beforeUpdateMessageListStack: Array<(list: TMessage[]) => TMessage[]> = [];
const indexCache = new WeakMap<TMessage[], MessageIndex>();
const conversationMessagesStore = new Map<string, ConversationMessagesEntry>();

const EMPTY_SNAPSHOT: ConversationMessagesSnapshot = {
  items: [],
  total: 0,
  pageSize: MESSAGE_PAGE_SIZE,
  loadedPages: [],
  oldestLoadedPage: null,
  latestLoadedPage: null,
  hasOlder: false,
  hydrated: false,
  isInitialLoading: false,
  isLoadingOlder: false,
};

const createEmptySnapshot = (): ConversationMessagesSnapshot => ({
  items: [],
  total: 0,
  pageSize: MESSAGE_PAGE_SIZE,
  loadedPages: [],
  oldestLoadedPage: null,
  latestLoadedPage: null,
  hasOlder: false,
  hydrated: false,
  isInitialLoading: false,
  isLoadingOlder: false,
});

const createConversationMessagesEntry = (): ConversationMessagesEntry => ({
  snapshot: createEmptySnapshot(),
  listeners: new Set(),
  lastAccessedAt: Date.now(),
});

const getLoadedPagesWithPage = (loadedPages: number[], page: number): number[] => {
  return Array.from(new Set([...loadedPages, page])).sort((a, b) => a - b);
};

const ensureConversationMessagesEntry = (conversationId: string): ConversationMessagesEntry => {
  const existing = conversationMessagesStore.get(conversationId);
  if (existing) {
    return existing;
  }
  const created = createConversationMessagesEntry();
  conversationMessagesStore.set(conversationId, created);
  return created;
};

const notifyConversationMessagesEntry = (entry: ConversationMessagesEntry) => {
  entry.listeners.forEach((listener) => listener());
};

const setConversationMessagesSnapshot = (
  conversationId: string,
  updater: (snapshot: ConversationMessagesSnapshot) => ConversationMessagesSnapshot
) => {
  const entry = ensureConversationMessagesEntry(conversationId);
  const nextSnapshot = updater(entry.snapshot);
  if (nextSnapshot === entry.snapshot) {
    return;
  }
  entry.snapshot = nextSnapshot;
  notifyConversationMessagesEntry(entry);
};

const touchConversationMessagesEntry = (conversationId: string) => {
  const entry = ensureConversationMessagesEntry(conversationId);
  entry.lastAccessedAt = Date.now();
  pruneConversationMessagesStore(conversationId);
};

function pruneConversationMessagesStore(activeConversationId?: string) {
  if (conversationMessagesStore.size <= MAX_RETAINED_CONVERSATIONS) {
    return;
  }

  const removableEntries = Array.from(conversationMessagesStore.entries())
    .filter(([conversationId, entry]) => {
      if (conversationId === activeConversationId) {
        return false;
      }
      if (entry.listeners.size > 0) {
        return false;
      }
      if (entry.initialLoadPromise || entry.olderLoadPromise) {
        return false;
      }
      return true;
    })
    .sort(([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt);

  while (conversationMessagesStore.size > MAX_RETAINED_CONVERSATIONS && removableEntries.length > 0) {
    const removable = removableEntries.shift();
    if (!removable) {
      break;
    }
    conversationMessagesStore.delete(removable[0]);
  }
}

const subscribeConversationMessages = (conversationId: string, listener: () => void) => {
  const entry = ensureConversationMessagesEntry(conversationId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
};

const getConversationMessagesSnapshot = (conversationId: string): ConversationMessagesSnapshot => {
  return ensureConversationMessagesEntry(conversationId).snapshot;
};

const mergeDatabaseMessagesWithCurrent = (databaseMessages: TMessage[], currentMessages: TMessage[]): TMessage[] => {
  if (!currentMessages.length) {
    return databaseMessages;
  }
  if (!databaseMessages.length) {
    return currentMessages;
  }

  const databaseIds = new Set(databaseMessages.map((message) => message.id));
  const databaseMsgIds = new Set(databaseMessages.map((message) => message.msg_id).filter(Boolean));
  const streamingOnlyMessages = currentMessages.filter(
    (message) => !databaseIds.has(message.id) && !(message.msg_id && databaseMsgIds.has(message.msg_id))
  );

  return streamingOnlyMessages.length > 0 ? [...databaseMessages, ...streamingOnlyMessages] : databaseMessages;
};

const prependOlderMessages = (olderMessages: TMessage[], currentMessages: TMessage[]): TMessage[] => {
  if (!olderMessages.length) {
    return currentMessages;
  }
  if (!currentMessages.length) {
    return olderMessages;
  }

  const olderIds = new Set(olderMessages.map((message) => message.id));
  const olderMsgIds = new Set(olderMessages.map((message) => message.msg_id).filter(Boolean));
  const remainingMessages = currentMessages.filter(
    (message) => !olderIds.has(message.id) && !(message.msg_id && olderMsgIds.has(message.msg_id))
  );

  return [...olderMessages, ...remainingMessages];
};

const buildMessageIndex = (list: TMessage[]): MessageIndex => {
  const msgIdIndex = new Map<string, number>();
  const callIdIndex = new Map<string, number>();
  const toolCallIdIndex = new Map<string, number>();

  for (let i = 0; i < list.length; i++) {
    const msg = list[i];
    if (msg.msg_id) msgIdIndex.set(msg.msg_id, i);
    if (msg.type === 'tool_call' && msg.content?.callId) {
      callIdIndex.set(msg.content.callId, i);
    }
    if (msg.type === 'codex_tool_call' && msg.content?.toolCallId) {
      toolCallIdIndex.set(msg.content.toolCallId, i);
    }
    if (msg.type === 'acp_tool_call' && msg.content?.update?.toolCallId) {
      toolCallIdIndex.set(msg.content.update.toolCallId, i);
    }
  }

  return { msgIdIndex, callIdIndex, toolCallIdIndex };
};

const getOrBuildIndex = (list: TMessage[]): MessageIndex => {
  let cached = indexCache.get(list);
  if (!cached) {
    cached = buildMessageIndex(list);
    indexCache.set(list, cached);
  }
  return cached;
};

const composeMessageWithIndex = (message: TMessage, list: TMessage[], index: MessageIndex): TMessage[] => {
  if (!message) return list || [];
  if (!list?.length) {
    if (message.msg_id) {
      index.msgIdIndex.set(message.msg_id, 0);
    }
    return [message];
  }

  if (message.type === 'tool_group') {
    const result = composeMessage(message, list);
    if (result !== list) {
      const rebuilt = buildMessageIndex(result);
      index.msgIdIndex = rebuilt.msgIdIndex;
      index.callIdIndex = rebuilt.callIdIndex;
      index.toolCallIdIndex = rebuilt.toolCallIdIndex;
    }
    return result;
  }

  if (message.type === 'tool_call' && message.content?.callId) {
    const existingIdx = index.callIdIndex.get(message.content.callId);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'tool_call') {
        const newList = list.slice();
        const merged = { ...existingMsg.content, ...message.content };
        newList[existingIdx] = { ...existingMsg, content: merged };
        return newList;
      }
    }
    const newIdx = list.length;
    index.callIdIndex.set(message.content.callId, newIdx);
    if (message.msg_id) index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  if (message.type === 'codex_tool_call' && message.content?.toolCallId) {
    const existingIdx = index.toolCallIdIndex.get(message.content.toolCallId);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'codex_tool_call') {
        const newList = list.slice();
        const merged = { ...existingMsg.content, ...message.content };
        newList[existingIdx] = { ...existingMsg, content: merged };
        return newList;
      }
    }
    const newIdx = list.length;
    index.toolCallIdIndex.set(message.content.toolCallId, newIdx);
    if (message.msg_id) index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  if (message.type === 'acp_tool_call' && message.content?.update?.toolCallId) {
    const existingIdx = index.toolCallIdIndex.get(message.content.update.toolCallId);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'acp_tool_call') {
        const newList = list.slice();
        const merged = { ...existingMsg.content, ...message.content };
        newList[existingIdx] = { ...existingMsg, content: merged };
        return newList;
      }
    }
    const newIdx = list.length;
    index.toolCallIdIndex.set(message.content.update.toolCallId, newIdx);
    if (message.msg_id) index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  if (message.type === 'text' && message.msg_id) {
    const existingIdx = index.msgIdIndex.get(message.msg_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'text') {
        if (message.position === 'right') {
          return list;
        }
        const newList = list.slice();
        newList[existingIdx] = {
          ...existingMsg,
          content: {
            ...existingMsg.content,
            content: existingMsg.content.content + message.content.content,
          },
        };
        return newList;
      }
    }
    const newIdx = list.length;
    index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  if (message.msg_id) {
    const existingIdx = index.msgIdIndex.get(message.msg_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      const newList = list.slice();
      newList[existingIdx] = {
        ...existingMsg,
        ...message,
        content: message.content,
      } as TMessage;
      return newList;
    }
  }

  const last = list[list.length - 1];
  if (last.msg_id !== message.msg_id || last.type !== message.type) {
    const newIdx = list.length;
    if (message.msg_id) index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  const newList = list.slice();
  const lastIdx = newList.length - 1;
  newList[lastIdx] = { ...last, ...message };
  return newList;
};

export type HydrateConversationMessagesOptions =
  | {
      mode?: 'latest';
    }
  | {
      mode: 'targeted';
      targetMessageId: string;
      targetPage?: number;
    };

type ResolvedHydrateTarget = {
  page: number;
  pageSize: number;
  total: number;
};

const resolveTargetHydrateTarget = async (
  conversationId: string,
  options: Extract<HydrateConversationMessagesOptions, { mode: 'targeted' }>
): Promise<ResolvedHydrateTarget> => {
  if (options.targetPage !== undefined) {
    return {
      page: Math.max(0, options.targetPage),
      pageSize: MESSAGE_PAGE_SIZE,
      total: 0,
    };
  }

  const location = await ipcBridge.database.getConversationMessageLocation.invoke({
    conversation_id: conversationId,
    message_id: options.targetMessageId,
    pageSize: MESSAGE_PAGE_SIZE,
  });

  const typedLocation = location as IConversationMessageLocation;
  if (!typedLocation.found) {
    throw new Error(`Target message not found: ${options.targetMessageId}`);
  }

  return {
    page: typedLocation.page,
    pageSize: typedLocation.pageSize || MESSAGE_PAGE_SIZE,
    total: typedLocation.total,
  };
};

const hydrateConversationMessages = async (
  conversationId: string,
  options: HydrateConversationMessagesOptions = { mode: 'latest' }
): Promise<void> => {
  if (!conversationId) {
    return;
  }

  touchConversationMessagesEntry(conversationId);
  const entry = ensureConversationMessagesEntry(conversationId);
  if (entry.snapshot.hydrated) {
    if (options.mode !== 'targeted') {
      return;
    }
    if (options.targetPage !== undefined && entry.snapshot.loadedPages.includes(options.targetPage)) {
      return;
    }
  }
  if (entry.initialLoadPromise) {
    return entry.initialLoadPromise;
  }

  setConversationMessagesSnapshot(conversationId, (current) => ({
    ...current,
    isInitialLoading: true,
  }));

  entry.initialLoadPromise = (async () => {
    try {
      const target =
        options.mode === 'targeted' ? await resolveTargetHydrateTarget(conversationId, options) : undefined;
      const pageSize = target?.pageSize || MESSAGE_PAGE_SIZE;

      const firstPage = await ipcBridge.database.getConversationMessagesPage.invoke({
        conversation_id: conversationId,
        page: 0,
        pageSize,
      });

      const total = target?.total || firstPage.total || 0;
      const lastPage = total > 0 ? Math.max(0, Math.ceil(total / pageSize) - 1) : 0;
      const requestedPage = target?.page ?? lastPage;
      const normalizedRequestedPage = Math.max(0, Math.min(requestedPage, lastPage));
      const hydratedPage =
        normalizedRequestedPage === (firstPage.page ?? 0)
          ? firstPage
          : await ipcBridge.database.getConversationMessagesPage.invoke({
              conversation_id: conversationId,
              page: normalizedRequestedPage,
              pageSize,
            });

      setConversationMessagesSnapshot(conversationId, (current) => {
        const loadedPage = hydratedPage.page ?? normalizedRequestedPage;
        const items = mergeDatabaseMessagesWithCurrent(hydratedPage.items ?? [], current.items);
        return {
          ...current,
          items,
          total: Math.max(hydratedPage.total ?? total, items.length),
          pageSize: hydratedPage.pageSize ?? pageSize,
          loadedPages: [loadedPage],
          oldestLoadedPage: loadedPage,
          latestLoadedPage: loadedPage,
          hasOlder: loadedPage > 0,
          hydrated: true,
          isInitialLoading: false,
          isLoadingOlder: false,
        };
      });
    } catch (error) {
      console.error('[Messages] Failed to hydrate conversation messages:', error);
      setConversationMessagesSnapshot(conversationId, (current) => ({
        ...current,
        hydrated: current.items.length > 0,
        isInitialLoading: false,
      }));
    } finally {
      entry.initialLoadPromise = undefined;
      touchConversationMessagesEntry(conversationId);
    }
  })();

  return entry.initialLoadPromise;
};

const loadOlderConversationMessages = async (conversationId: string): Promise<void> => {
  if (!conversationId) {
    return;
  }

  touchConversationMessagesEntry(conversationId);
  const entry = ensureConversationMessagesEntry(conversationId);
  if (!entry.snapshot.hydrated) {
    await hydrateConversationMessages(conversationId);
  }

  const currentSnapshot = ensureConversationMessagesEntry(conversationId).snapshot;
  if (!currentSnapshot.hasOlder || currentSnapshot.oldestLoadedPage === null || currentSnapshot.oldestLoadedPage <= 0) {
    return;
  }
  if (entry.olderLoadPromise) {
    return entry.olderLoadPromise;
  }

  const targetPage = currentSnapshot.oldestLoadedPage - 1;
  setConversationMessagesSnapshot(conversationId, (current) => ({
    ...current,
    isLoadingOlder: true,
  }));

  entry.olderLoadPromise = (async () => {
    try {
      const result = await ipcBridge.database.getConversationMessagesPage.invoke({
        conversation_id: conversationId,
        page: targetPage,
        pageSize: currentSnapshot.pageSize || MESSAGE_PAGE_SIZE,
      });

      setConversationMessagesSnapshot(conversationId, (current) => {
        const loadedPage = result.page ?? targetPage;
        if (current.loadedPages.includes(loadedPage)) {
          return {
            ...current,
            total: Math.max(result.total ?? current.total, current.items.length),
            pageSize: result.pageSize ?? current.pageSize,
            hasOlder: (current.oldestLoadedPage ?? loadedPage) > 0,
            isLoadingOlder: false,
          };
        }

        const loadedPages = getLoadedPagesWithPage(current.loadedPages, loadedPage);
        const oldestLoadedPage = loadedPages[0] ?? loadedPage;
        const latestLoadedPage = loadedPages[loadedPages.length - 1] ?? loadedPage;
        const items = prependOlderMessages(result.items ?? [], current.items);

        return {
          ...current,
          items,
          total: Math.max(result.total ?? current.total, items.length),
          pageSize: result.pageSize ?? current.pageSize,
          loadedPages,
          oldestLoadedPage,
          latestLoadedPage,
          hasOlder: oldestLoadedPage > 0,
          hydrated: true,
          isLoadingOlder: false,
        };
      });
    } catch (error) {
      console.error('[Messages] Failed to load older conversation messages:', error);
      setConversationMessagesSnapshot(conversationId, (current) => ({
        ...current,
        isLoadingOlder: false,
      }));
    } finally {
      entry.olderLoadPromise = undefined;
      touchConversationMessagesEntry(conversationId);
    }
  })();

  return entry.olderLoadPromise;
};

export const useConversationMessagesState = (conversationId?: string): ConversationMessagesSnapshot => {
  const conversationContext = useConversationContextSafe();
  const resolvedConversationId = conversationId ?? conversationContext?.conversationId ?? '';

  useEffect(() => {
    if (!resolvedConversationId) {
      return;
    }
    touchConversationMessagesEntry(resolvedConversationId);
  }, [resolvedConversationId]);

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!resolvedConversationId) {
        return () => {};
      }
      return subscribeConversationMessages(resolvedConversationId, listener);
    },
    [resolvedConversationId]
  );

  const getSnapshot = useCallback(() => {
    if (!resolvedConversationId) {
      return EMPTY_SNAPSHOT;
    }
    return getConversationMessagesSnapshot(resolvedConversationId);
  }, [resolvedConversationId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export const useConversationMessagePagination = (conversationId?: string) => {
  const conversationContext = useConversationContextSafe();
  const resolvedConversationId = conversationId ?? conversationContext?.conversationId ?? '';
  const snapshot = useConversationMessagesState(resolvedConversationId);

  const hydrate = useCallback(() => {
    if (!resolvedConversationId) {
      return Promise.resolve();
    }
    return hydrateConversationMessages(resolvedConversationId);
  }, [resolvedConversationId]);

  const loadOlder = useCallback(() => {
    if (!resolvedConversationId) {
      return Promise.resolve();
    }
    return loadOlderConversationMessages(resolvedConversationId);
  }, [resolvedConversationId]);

  return {
    ...snapshot,
    hydrate,
    loadOlder,
  };
};

export const useMessageList = () => {
  return useConversationMessagesState().items;
};

export const useUpdateMessageList = () => {
  const { conversationId } = useConversationContext();

  return useCallback(
    (value: MessageListUpdater) => {
      setConversationMessagesSnapshot(conversationId, (current) => {
        const items = typeof value === 'function' ? value(current.items) : value;
        return {
          ...current,
          items,
          total: Math.max(current.total, items.length),
        };
      });
      touchConversationMessagesEntry(conversationId);
    },
    [conversationId]
  );
};

export const useAddOrUpdateMessage = () => {
  const update = useUpdateMessageList();
  const pendingRef = useRef<Array<{ message: TMessage; add: boolean }>>([]);
  const rafRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;

    const pending = pendingRef.current;
    if (!pending.length) return;
    pendingRef.current = [];
    update((list) => {
      const index = getOrBuildIndex(list);
      let newList = list;

      for (const item of pending) {
        if (item.add) {
          const msg = item.message;
          const newIdx = newList.length;
          if (msg.msg_id) index.msgIdIndex.set(msg.msg_id, newIdx);
          if (msg.type === 'tool_call' && msg.content?.callId) {
            index.callIdIndex.set(msg.content.callId, newIdx);
          }
          if (msg.type === 'codex_tool_call' && msg.content?.toolCallId) {
            index.toolCallIdIndex.set(msg.content.toolCallId, newIdx);
          }
          if (msg.type === 'acp_tool_call' && msg.content?.update?.toolCallId) {
            index.toolCallIdIndex.set(msg.content.update.toolCallId, newIdx);
          }
          newList = newList.concat(msg);
        } else {
          newList = composeMessageWithIndex(item.message, newList, index);
        }

        while (beforeUpdateMessageListStack.length) {
          const updater = beforeUpdateMessageListStack.shift();
          if (!updater) {
            break;
          }
          newList = updater(newList);
        }
      }
      return newList;
    });

    rafRef.current = setTimeout(flush);
  }, [update]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        clearTimeout(rafRef.current);
      }
    };
  }, []);

  return useCallback(
    (message: TMessage, add = false) => {
      pendingRef.current.push({ message, add });
      if (rafRef.current === null) {
        rafRef.current = setTimeout(flush);
      }
    },
    [flush]
  );
};

export const useMessageLstCache = (key: string, options: HydrateConversationMessagesOptions = { mode: 'latest' }) => {
  useEffect(() => {
    if (!key) {
      return;
    }
    void hydrateConversationMessages(key, options);
  }, [
    key,
    options.mode,
    options.mode === 'targeted' ? options.targetMessageId : undefined,
    options.mode === 'targeted' ? options.targetPage : undefined,
  ]);
};

export const refreshConversationMessages = async (
  conversationId: string,
  options: HydrateConversationMessagesOptions = { mode: 'latest' }
): Promise<void> => {
  if (!conversationId) {
    return;
  }

  setConversationMessagesSnapshot(conversationId, () => createEmptySnapshot());
  return hydrateConversationMessages(conversationId, options);
};

export const hydrateConversationMessageTarget = async (
  conversationId: string,
  targetMessageId: string,
  targetPage?: number
): Promise<void> => {
  if (!conversationId || !targetMessageId) {
    return;
  }

  return hydrateConversationMessages(conversationId, {
    mode: 'targeted',
    targetMessageId,
    targetPage,
  });
};

export const beforeUpdateMessageList = (fn: (list: TMessage[]) => TMessage[]) => {
  beforeUpdateMessageListStack.push(fn);
  return () => {
    const index = beforeUpdateMessageListStack.indexOf(fn);
    if (index >= 0) {
      beforeUpdateMessageListStack.splice(index, 1);
    }
  };
};

export const MessageListProvider: FC<PropsWithChildren<Record<string, unknown>>> = ({ children }) => {
  return createElement(Fragment, null, children);
};

export const ChatKeyProvider: FC<PropsWithChildren<Record<string, unknown>>> = ({ children }) => {
  return createElement(Fragment, null, children);
};

export const useChatKey = () => {
  return useConversationContext().conversationId;
};
