/* Agent Chat as the host sees it. The Node implementation is host/node/chat (createChatRunner); the values these
   methods return and emit are the ones the Mac app's ChatRunner produced (Chat.swift), which the page reads. */
import type { PlatformFS } from './platform';
export interface ChatRunner {
  providersForPage(): Promise<unknown[]>;
  start(body: Record<string, unknown>): Promise<unknown>;
  stop(chat: string): void;
  skillsForPage(provider: string): Promise<unknown[]>;
  login(provider: string): unknown;
  loadHistory(key: string): unknown;
  saveHistory(key: string, data: unknown): unknown;
  moveHistory(from: string, to: string): void;
  deleteHistory(id: string): void;
  stopAll(): void;
}
export interface ChatRunnerOptions { mcpCommand: string; workDir: string; emit(event: unknown): void; fs: PlatformFS; }
