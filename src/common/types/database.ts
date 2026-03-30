import type { TMessage } from '../chat/chatLib';
import type { TChatConversation } from '../config/storage';

export interface IConversationMessagesPage {
  items: TMessage[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface IConversationMessageLocation {
  conversationId: string;
  messageId: string;
  page: number;
  pageSize: number;
  total: number;
  indexWithinPage: number;
  absoluteIndex: number;
  found: boolean;
}

export interface IMessageSearchItem {
  conversation: TChatConversation;
  messageId: string;
  messageType: TMessage['type'];
  messageCreatedAt: number;
  previewText: string;
}

export interface IMessageSearchResponse {
  items: IMessageSearchItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
