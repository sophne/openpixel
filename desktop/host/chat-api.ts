/* Agent Chat as the host sees it. The runner itself (the person's own agent CLIs, run headless) lives in
   host/node/chat; the shell passes its factory to createHost as `chat`. */
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

export interface ChatRunnerOptions {
  mcpCommand: string;
  workDir: string;
  emit(event: unknown): void;
  fs: PlatformFS;
}
