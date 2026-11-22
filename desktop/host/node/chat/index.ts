/* Agent Chat's backend for the desktop app: finds the person's agent tools, runs them headless with OpenPixel's MCP
   server attached, turns their output into the page's events, and keeps each file's chats.
     providers.ts  the agents and what the menu offers          launch.ts   finding and starting the tools
     runner.ts     the runner itself (Chat.swift)               streams.ts  Claude, Codex, Cursor, Gemini output
     agents.ts     the other agents (ChatAgents.swift)          skills.ts   the "/" menu (ChatSkills.swift)
     history.ts    chats per file                               values.ts   reading values as the Swift did
   Node's own modules only, and nothing TypeScript has to rewrite, so Node 22 runs the files as they are:
     node --test "desktop/host/node/chat/*.test.ts"             (from the repository; the quotes matter)
     cd desktop && npx tsc -p host/node/chat/tsconfig.json      (imports end in .ts, which needs allowImportingTsExtensions) */
import type { ChatRunner, ChatRunnerOptions } from '../../chat-api.ts';
import { Runner } from './runner.ts';

export function createChatRunner(options: ChatRunnerOptions): ChatRunner {
  return new Runner(options);
}
