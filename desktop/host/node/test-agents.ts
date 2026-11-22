/* UI tests: agents on demand. Starts `openpixel --mcp` like an agent would, introduces it under a name and lets it
   make one call, so the Agents page has real connections to show (the `spawnAgent` / `stopAgents` test
   messages). */
import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';

export class TestAgents {
  private running: ChildProcess[] = [];

  /** `command` is the native `openpixel` program. Throws Error(text) when it is not there to start. */
  spawn(options: { command: string; socketPath: string; client: string; call: boolean }): void {
    if (options.command === '' || !fs.existsSync(options.command)) throw new Error(`The program agents start is missing: ${options.command}`);
    const child = spawn(options.command, ['--mcp'], {
      env: { ...process.env, OPENPIXEL_SOCKET: options.socketPath },
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
    child.on('error', () => undefined);
    child.stdin?.on('error', () => undefined);
    this.running.push(child);
    const lines = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: options.client, version: '1.0' } } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ];
    // `call: false` starts an agent that connects but hasn't done anything yet.
    if (options.call) lines.push(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_model_info', arguments: {} } }));
    child.stdin?.write(lines.join('\n') + '\n');
  }

  /** Lets every agent finish: closes its input and waits until it has gone. */
  async stop(): Promise<void> {
    const all = this.running;
    this.running = [];
    await Promise.all(all.map((child) => new Promise<void>((done) => {
      if (child.exitCode !== null || child.signalCode !== null) return done();
      child.once('exit', () => done());
      child.once('error', () => done());
      child.stdin?.end();
    })));
  }

  /** Ends them at once. */
  kill(): void {
    for (const child of this.running) child.kill();
    this.running = [];
  }
}
