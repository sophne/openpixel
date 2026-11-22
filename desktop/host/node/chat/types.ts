/* What the parts of Agent Chat share: one run of an agent, and what a parser may ask of the runner. In the Swift
   these were ChatRunner.Run and ChatRunner itself (the parsers were its methods and extensions). */
import type { ChildProcess } from 'node:child_process';
import type { Writable } from 'node:stream';
import type { PlatformFS } from '../../platform';
import type { Provider } from './providers.ts';
import type { Dict } from './values.ts';

/** An event for the page: session, text, think, tool, tool_input, tool_done, error, done (and providers). */
export type ChatEvent = Dict & { t: string };

export type Env = Record<string, string>;

/** One message being answered: the agent's process and what its stream has said so far. */
export interface Run {
  id: string;
  provider: string;
  child: ChildProcess | null;
  buffer: Buffer;               // output that has not reached a line break yet
  stderr: Buffer[];
  stderrSize: number;
  finished: boolean;
  gotResult: boolean;
  stopped: boolean;
  segment: string;              // the reply text of the current block (Cursor repeats it at the end)
  tools: Map<string, string>;   // id -> name
  session: string | null;       // the agent's session, once it said
  sentText: boolean;            // some reply text arrived (Kiro: else its final text is used)
  reportedError: boolean;       // an error was already shown (no second one from stderr)
  input: Writable | null;       // ACP agents (Hermes) talk over stdin
  prompt: string;
  stopTimer: NodeJS.Timeout | null;  // the second, firmer stop, if the first is not heeded
}

export function newRun(id: string, provider: string): Run {
  return { id, provider, child: null, buffer: Buffer.alloc(0), stderr: [], stderrSize: 0, finished: false, gotResult: false,
           stopped: false, segment: '', tools: new Map(), session: null, sentText: false, reportedError: false,
           input: null, prompt: '', stopTimer: null };
}

/** The runner, as the parsers, the other agents and the skills see it. */
export interface ChatContext {
  readonly mcpCommand: string;
  readonly workDir: string;
  readonly fs: PlatformFS;
  /** Sends one event to the page, marked with the run's chat. */
  send(run: Run, e: ChatEvent): void;
  find(p: Provider): Promise<string | null>;
  env(): Promise<Env>;
  /** Runs a short command and gives what it printed (null when it fails or takes longer than `timeout` seconds). */
  capture(exe: string, args: string[], options: { env?: Env; timeout: number }): Promise<string | null>;
}
