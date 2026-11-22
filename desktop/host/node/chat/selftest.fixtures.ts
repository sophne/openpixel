/* The recorded and documented output of each agent, with what the page should show for it (see selftest.test.ts).
   The cases were copied by a script from the Swift app's self-test, so every line is as it was recorded there.
   Streams marked "recorded" come from real runs of that agent; "documented" ones follow the agent's own source or
   docs (see the note on each), for agents not installed on the machine that made them. */

export interface Case {
  name: string;
  provider: string;
  lines: string;
  expect: string[];
  exitStatus?: number;
  stderr?: string;
}

// MARK: - Gemini CLI (gemini -p … --output-format stream-json)
const gemini: Case[] = [
  { name: "text, a tool and the result (documented verbatim: packages/cli/src/__snapshots__/nonInteractiveCli.test.ts.snap)", provider: "gemini-cli", lines: String.raw`
{"type":"init","timestamp":"<TIMESTAMP>","session_id":"test-session-id","model":"test-model"}
{"type":"message","timestamp":"<TIMESTAMP>","role":"user","content":"Stream test"}
{"type":"message","timestamp":"<TIMESTAMP>","role":"assistant","content":"Thinking...","delta":true}
{"type":"tool_use","timestamp":"<TIMESTAMP>","tool_name":"testTool","tool_id":"tool-1","parameters":{"arg1":"value1"}}
{"type":"tool_result","timestamp":"<TIMESTAMP>","tool_id":"tool-1","status":"success","output":"Tool executed successfully"}
{"type":"message","timestamp":"<TIMESTAMP>","role":"assistant","content":"Final answer","delta":true}
{"type":"result","timestamp":"<TIMESTAMP>","status":"success","stats":{"total_tokens":0,"input_tokens":0,"output_tokens":0,"cached":0,"input":0,"duration_ms":1,"tool_calls":0,"models":{}}}
`,
    expect: ["session", "text:Thinking...", "tool testTool", "ok testTool", "text:Final answer", "done"] },
  { name: "an OpenPixel tool error, a warning, a fatal result (documented: mcp-tool.ts, nonInteractiveCli.ts, errors.ts)", provider: "gemini-cli", lines: String.raw`
{"type":"init","timestamp":"t","session_id":"s-g","model":"gemini-3-pro"}
{"type":"tool_use","timestamp":"t","tool_name":"mcp_openpixel_set_pixels","tool_id":"c1","parameters":{"pixels":[]}}
{"type":"tool_result","timestamp":"t","tool_id":"c1","status":"error","output":"Error: MCP tool 'set_pixels' reported an error.","error":{"type":"mcp_tool_error","message":"MCP tool 'set_pixels' reported tool error"}}
{"type":"error","timestamp":"t","severity":"warning","message":"Loop detected, stopping execution"}
{"type":"result","timestamp":"t","status":"error","error":{"type":"MaxSessionTurnsError","message":"Maximum session turns exceeded"},"stats":{"total_tokens":100}}
`,
    expect: ["session", "tool set_pixels", "failed set_pixels", "error: Maximum session turns exceeded", "done failed"], exitStatus: 53 },
  { name: "signed out: plain text on stderr, exit 41 (documented: validateNonInterActiveAuth.ts)", provider: "gemini-cli", lines: '',
    expect: ["error: Please set an Auth method in your settings.json", "done failed"], exitStatus: 41,
    stderr: "Please set an Auth method in your settings.json\n" },
];

// MARK: - GitHub Copilot CLI (copilot -p … --output-format json)
const copilot: Case[] = [
  { name: "a whole message (documented verbatim: github/copilot-cli issue #2000 events.jsonl, 1.0.4; result per crew44 parser)", provider: "copilot", lines: String.raw`
{"type":"session.start","data":{"sessionId":"<session-id>","version":1,"producer":"copilot-agent","copilotVersion":"1.0.4","startTime":"2026-03-12T12:36:24.489Z","context":{"cwd":"/path/to/project"},"alreadyInUse":false},"id":"<uuid-1>","timestamp":"2026-03-12T12:36:24.540Z","parentId":null}
{"type":"assistant.turn_start","data":{"turnId":"0","interactionId":"<uuid-2>"},"id":"<uuid-5>","timestamp":"2026-03-12T12:36:30.142Z","parentId":"<uuid-3>"}
{"type":"assistant.message","data":{"messageId":"<uuid-6>","content":"Hi! How can I help you today?","toolRequests":[],"interactionId":"<uuid-2>","outputTokens":12},"id":"<uuid-7>","timestamp":"2026-03-12T12:36:33.201Z","parentId":"<uuid-8>"}
{"type":"assistant.turn_end","data":{"turnId":"0"},"id":"<uuid-9>","timestamp":"2026-03-12T12:36:33.201Z","parentId":"<uuid-7>"}
{"type":"result","sessionId":"<session-id>","exitCode":0,"usage":{"premiumRequests":1}}
`,
    expect: ["session", "text:Hi! How can I help you today?", "done"] },
  { name: "deltas, reasoning, tools that work and fail (documented: copilot-sdk session-events.ts; ralph-orchestrator copilot_stream.rs)", provider: "copilot", lines: String.raw`
{"type":"assistant.message_delta","data":{"messageId":"msg-1","deltaContent":"hello"}}
{"type":"assistant.reasoning_delta","data":{"reasoningId":"reason-1","deltaContent":"Thinking..."}}
{"type":"assistant.reasoning","data":{"reasoningId":"reason-1","content":"Thinking..."}}
{"type":"assistant.message","data":{"messageId":"msg-1","content":"hello","toolRequests":[{"toolCallId":"tool-1","name":"bash","arguments":{"command":"echo hi"},"type":"function"}]}}
{"type":"tool.execution_start","data":{"toolCallId":"tool-1","toolName":"bash","arguments":{"command":"echo hi"}}}
{"type":"tool.execution_complete","data":{"toolCallId":"tool-1","success":true,"result":{"content":"hi\n","detailedContent":"hi\n"}}}
{"type":"tool.execution_start","data":{"toolCallId":"tool-2","toolName":"openpixel-set_pixels","arguments":{"pixels":[]},"mcpServerName":"openpixel","mcpToolName":"set_pixels"}}
{"type":"tool.execution_complete","data":{"toolCallId":"tool-2","success":false,"error":{"message":"Permission denied and could not request permission from user","code":"denied"}}}
{"type":"session.idle","data":{"backgroundTasks":{}}}
{"type":"result","exitCode":0,"usage":{"totalApiDurationMs":12,"sessionDurationMs":34}}
`,
    expect: ["text:hello", "think", "tool bash", "ok bash", "tool set_pixels", "failed set_pixels", "done"] },
  { name: "signed out (documented: session.error remediation sign_in, result on auth failure since 1.0.110)", provider: "copilot", lines: String.raw`
{"type":"session.error","data":{"errorType":"authentication","message":"No authentication information found.","remediation":"sign_in"},"id":"e","timestamp":"t","parentId":null}
{"type":"result","exitCode":1}
`,
    expect: ["error: GitHub Copilot isn't signed in. Choose Sign in to GitHub Copilot… in the agent menu, then send again.", "done failed"], exitStatus: 1 },
];

// MARK: - opencode (opencode run --format json)
const opencode: Case[] = [
  { name: "finished text, reasoning and tools (documented: V2 noninteractive.ts renderer types)", provider: "opencode", lines: String.raw`
{"type":"step_start","timestamp":1763600000000,"sessionID":"ses_1","part":{"id":"prt_x","sessionID":"ses_1","messageID":"msg_assistant","type":"step-start","snapshot":"s"}}
{"type":"reasoning","timestamp":1763600000050,"sessionID":"ses_1","part":{"id":"prt_r","sessionID":"ses_1","messageID":"msg_assistant","type":"reasoning","text":"Look first.","metadata":{},"time":{"start":1,"end":2}}}
{"type":"tool_use","timestamp":1763600001000,"sessionID":"ses_1","part":{"partID":"prt_t","sessionID":"ses_1","messageID":"msg_assistant","type":"tool","id":"call_1","tool":"openpixel_get_model_info","state":{"status":"completed","input":{},"output":"16x16","title":"openpixel_get_model_info","metadata":{},"time":{"start":1,"end":2}}}}
{"type":"tool_use","timestamp":1763600002000,"sessionID":"ses_1","part":{"partID":"prt_u","sessionID":"ses_1","messageID":"msg_assistant","type":"tool","id":"call_failed_tool","tool":"shell","state":{"status":"error","input":{"command":"printf partial && false"},"error":"tool failed","metadata":{},"time":{"start":1,"end":2}}}}
{"type":"text","timestamp":1763600000500,"sessionID":"ses_1","part":{"id":"prt_y","sessionID":"ses_1","messageID":"msg_assistant","type":"text","text":"Here is the sprite.","time":{"start":1763600000100,"end":1763600000500}}}
{"type":"step_finish","timestamp":1763600003000,"sessionID":"ses_1","part":{"id":"prt_z","sessionID":"ses_1","messageID":"msg_assistant","type":"step-finish","reason":"stop","cost":0.25}}
`,
    expect: ["session", "think", "tool get_model_info", "ok get_model_info", "tool shell", "failed shell", "text:Here is the sprite.", "done"] },
  { name: "an error line then exit 1, V2 and V1 shapes (documented: noninteractive.test.ts, V1 run.ts / ProviderAuthError)", provider: "opencode", lines: String.raw`
{"type":"error","timestamp":5,"sessionID":"ses_1","error":{"type":"provider.transport","message":"instructions unavailable"}}
{"type":"error","timestamp":6,"sessionID":"ses_1","error":{"name":"ProviderAuthError","data":{"providerID":"anthropic","message":"Not signed in to Anthropic"}}}
`,
    expect: ["session", "error: instructions unavailable", "error: Not signed in to Anthropic", "done failed"], exitStatus: 1,
    stderr: "should not be shown twice\n" },
];

// MARK: - Kiro CLI (kiro-cli chat --no-interactive --v2 --output-format stream-json)
const kiro: Case[] = [
  { name: "a short answer (documented verbatim: kiro-cli 2.x capture, mkny13/mahler #695)", provider: "kiro", lines: String.raw`
{"type":"runStarted","data":{"payloadSchema":"acp","acpProtocolVersion":1,"engine":"v2"}}
{"type":"metadata","data":{"sessionId":"b535b357-079b-4b50-808f-6a08ea5e3ad8","contextUsagePercentage":3.58,"reasoning":{"support":"unavailable","effortLevels":[]}}}
{"type":"sessionUpdate","data":{"sessionId":"b535b357-079b-4b50-808f-6a08ea5e3ad8","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"OK"}}}}
{"type":"metadata","data":{"sessionId":"b535b357-079b-4b50-808f-6a08ea5e3ad8","contextUsagePercentage":1.23,"meteringUsage":[{"value":0.028413729353233837,"unit":"credit","unitPlural":"credits"}],"turnDurationMs":1037}}
{"type":"runFinished","data":{"sessionId":"b535b357-079b-4b50-808f-6a08ea5e3ad8","status":"success","stopReason":"end_turn","finalText":"OK","finalTextTruncated":false}}
`,
    expect: ["session", "text:OK", "done"] },
  { name: "an OpenPixel tool, a refused shell call, a run error (verbatim tool_call_update from ndmxjp/Kiro-action #10; ACP tool_call)", provider: "kiro", lines: String.raw`
{"type":"metadata","data":{"sessionId":"k-2"}}
{"type":"sessionUpdate","data":{"sessionId":"k-2","update":{"sessionUpdate":"tool_call","toolCallId":"t1","title":"get_model_info","kind":"other","status":"pending","rawInput":{},"_meta":{"kiro":{"toolName":"@openpixel/get_model_info"}}}}}
{"type":"sessionUpdate","data":{"sessionId":"k-2","update":{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed","content":[{"type":"content","content":{"type":"text","text":"16x16"}}]}}}
{"type":"sessionUpdate","data":{"sessionId":"…","update":{"sessionUpdate":"tool_call_update","toolCallId":"toolu_…","kind":"execute","status":"failed","title":"shell","content":[{"type":"content","content":{"type":"text","text":"Tool use was rejected because the arguments supplied are forbidden"}}],"rawInput":{"command":"curl -s example.com"},"_meta":{"kiro":{"toolName":"shell"}}}}}
{"type":"runError","data":{"sessionId":"k-2","stage":"turn","message":"The model is overloaded"}}
`,
    expect: ["session", "tool get_model_info", "ok get_model_info", "tool shell", "failed shell", "error: The model is overloaded", "done failed"], exitStatus: 1 },
];

// MARK: - Goose (goose run --output-format stream-json)
const goose: Case[] = [
  { name: "text, tool request and response, isError (documented: session/mod.rs events; message.rs test fixtures)", provider: "goose", lines: String.raw`
{"type":"message","message":{"id":null,"role":"user","created":1,"content":[{"type":"text","text":"draw a heart"}]}}
{"type":"message","message":{"id":null,"role":"assistant","created":2,"content":[{"type":"text","text":"Drawing"}]}}
{"type":"message","message":{"id":null,"role":"assistant","created":2,"content":[{"type":"text","text":" now."}]}}
{"type":"message","message":{"id":null,"role":"assistant","created":3,"content":[{"type": "toolRequest","id": "tool123","toolCall": {"status": "success","value": {"name": "test_tool","arguments": {"param": "value"}}}}]}}
{"type":"message","message":{"id":null,"role":"user","created":4,"content":[{"type": "toolResponse","id": "tool123","toolResult": {"status": "success","value": {"content": [{"type": "text","text": "New format output"}],"isError": false}}}]}}
{"type":"message","message":{"id":null,"role":"assistant","created":5,"content":[{"type":"toolRequest","id":"tool456","toolCall":{"status":"success","value":{"name":"openpixel__set_pixels","arguments":{}}}}]}}
{"type":"message","message":{"id":null,"role":"user","created":6,"content":[{"type":"toolResponse","id":"tool456","toolResult":{"status":"success","value":{"content":[{"type":"text","text":"bad colour"}],"isError":true}}}]}}
{"type":"message","message":{"id":null,"role":"assistant","created":7,"content":[{"type":"toolRequest","id":"tool789","toolCall":{"status":"error","error":"-32603: Something went wrong"}}]}}
{"type":"complete","total_tokens":null}
`,
    expect: ["session", "text:Drawing now.", "tool test_tool", "ok test_tool", "tool set_pixels", "failed set_pixels", "tool tool", "failed tool", "done"] },
  { name: "a terminal error (documented: session/mod.rs, no complete after it)", provider: "goose", lines: String.raw`
{"type":"error","error":"No provider configured. Run 'goose configure' first"}
`,
    expect: ["session", "error: No provider configured. Run 'goose configure' first", "done failed"], exitStatus: 1 },
];

// MARK: - Cline CLI (cline --json)
const cline: Case[] = [
  { name: "text deltas, tools (error key only on failure), done (documented: done line verbatim from cli-reference.mdx; agents/types.ts)", provider: "cline", lines: String.raw`
{"ts":"2026-10-07T04:49:42.000Z","type":"agent_event","event":{"type":"content_start","contentType":"text","text":"Hel","accumulated":"Hel"}}
{"ts":"2026-10-07T04:49:42.100Z","type":"agent_event","event":{"type":"content_start","contentType":"text","text":"lo!","accumulated":"Hello!"}}
{"ts":"2026-10-07T04:49:42.200Z","type":"agent_event","event":{"type":"content_end","contentType":"text","text":"Hello!"}}
{"ts":"2026-10-07T04:49:42.300Z","type":"agent_event","event":{"type":"content_start","contentType":"tool","toolName":"get_model_info","toolCallId":"c1","input":{}}}
{"ts":"2026-10-07T04:49:42.400Z","type":"agent_event","event":{"type":"content_end","contentType":"tool","toolName":"get_model_info","toolCallId":"c1","output":"16x16","durationMs":5}}
{"ts":"2026-10-07T04:49:42.500Z","type":"agent_event","event":{"type":"content_start","contentType":"tool","toolName":"set_pixels","toolCallId":"c2","input":{}}}
{"ts":"2026-10-07T04:49:42.600Z","type":"agent_event","event":{"type":"content_end","contentType":"tool","toolName":"set_pixels","toolCallId":"c2","output":null,"error":"bad colour","durationMs":5}}
{"ts":"2026-10-07T04:49:43.041Z","type":"agent_event","event":{"type":"done","reason":"completed","text":"Hello!","iterations":1}}
{"ts":"2026-10-07T04:49:43.050Z","type":"run_result","finishReason":"completed","iterations":1,"durationMs":1050,"text":"Hello!","model":"x"}
`,
    expect: ["text:Hello!", "tool get_model_info", "ok get_model_info", "tool set_pixels", "failed set_pixels", "done"] },
  { name: "an error as JSON on stderr (documented: apps/cli/src/utils/output.ts)", provider: "cline", lines: '',
    expect: ["error: No provider configured. Run cline auth.", "done failed"], exitStatus: 1,
    stderr: "{\"type\":\"error\",\"message\":\"No provider configured. Run cline auth.\"}\n" },
];

// MARK: - Hermes Agent (hermes acp: JSON-RPC over stdin/stdout)
const hermes: Case[] = [
  { name: "thinking, tools and streamed text over ACP (recorded: hermes-agent 0.19.1)", provider: "hermes", lines: String.raw`
{"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": 1, "agentInfo": {"name": "hermes-agent", "version": "0.19.1"}}}
{"jsonrpc": "2.0", "id": 2, "result": {"sessionId": "6bb566f8-019b-4eaa-9ec7-d63553fed4af"}}
{"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "6bb566f8-019b-4eaa-9ec7-d63553fed4af", "update": {"content": {"text": "**Clarifying deferred call sequence**", "type": "text"}, "sessionUpdate": "agent_thought_chunk"}}}
{"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "6bb566f8-019b-4eaa-9ec7-d63553fed4af", "update": {"content": [{"content": {"text": "{\n  \"name\": \"mcp__openpixel__get_model_info\"\n}", "type": "text"}, "type": "content"}], "kind": "other", "locations": [], "rawInput": {"name": "mcp__openpixel__get_model_info"}, "title": "tool_describe", "toolCallId": "tc-220d0b285462", "sessionUpdate": "tool_call"}}}
{"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "6bb566f8-019b-4eaa-9ec7-d63553fed4af", "update": {"content": [{"content": {"text": "tool_describe result", "type": "text"}, "type": "content"}], "kind": "other", "status": "completed", "toolCallId": "tc-220d0b285462", "sessionUpdate": "tool_call_update"}}}
{"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "6bb566f8-019b-4eaa-9ec7-d63553fed4af", "update": {"kind": "other", "locations": [], "title": "mcp__openpixel__get_model_info", "toolCallId": "tc-ce5972a6cd65", "sessionUpdate": "tool_call"}}}
{"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "6bb566f8-019b-4eaa-9ec7-d63553fed4af", "update": {"content": {"text": "\n\nThe canvas", "type": "text"}, "sessionUpdate": "agent_message_chunk"}}}
{"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "6bb566f8-019b-4eaa-9ec7-d63553fed4af", "update": {"content": {"text": " size is 16 × 16 pixels.", "type": "text"}, "sessionUpdate": "agent_message_chunk"}}}
{"jsonrpc": "2.0", "id": 3, "result": {"stopReason": "end_turn", "usage": {"totalTokens": 38921}}}
`,
    expect: ["think", "tool tool_describe", "ok tool_describe", "tool get_model_info", "text:The canvas size is 16 × 16 pixels.", "done"] },
  { name: "an MCP error reported as completed, a permission request, a refusal (documented: acp_adapter/tools.py, mcp_tool.py)", provider: "hermes", lines: String.raw`
{"jsonrpc": "2.0", "id": 2, "result": {"sessionId": "h-2"}}
{"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "h-2", "update": {"sessionUpdate": "tool_call", "toolCallId": "a", "title": "mcp__openpixel__set_pixels", "kind": "other", "rawInput": {"pixels": []}}}}
{"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "h-2", "update": {"sessionUpdate": "tool_call_update", "toolCallId": "a", "status": "completed", "content": [{"type": "content", "content": {"type": "text", "text": "{\"error\": \"colour 99 is not in the palette\"}"}}]}}}
{"jsonrpc": "2.0", "id": 7, "method": "session/request_permission", "params": {"sessionId": "h-2", "toolCall": {"toolCallId": "b", "title": "terminal"}, "options": [{"optionId": "allow", "kind": "allow_once", "name": "Allow"}, {"optionId": "deny", "kind": "reject_once", "name": "Deny"}]}}
{"jsonrpc": "2.0", "id": 3, "result": {"stopReason": "refusal"}}
`,
    expect: ["tool set_pixels", "failed set_pixels", "error: Hermes declined this request.", "done failed"] },
];

// MARK: - Claude Code (recorded: claude -p --output-format stream-json --verbose --include-partial-messages)
const claude: Case[] = [
  { name: "tool call and streamed reply (recorded)", provider: "claude-code", lines: String.raw`
{"type": "system", "subtype": "init", "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49", "model": "claude-haiku-5-5", "tools": ["mcp__openpixel__add_colors"], "slash_commands": ["emil-design-eng"]}
{"type": "stream_event", "event": {"type": "message_start", "message": {"model": "claude-haiku-5-5", "id": "msg_011ChF459c1AmmT7ENLoZ4gu", "type": "message", "role": "assistant", "content": [], "stop_reason": null}}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49"}
{"type": "stream_event", "event": {"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": "toolu_01YbTBCLLFcqu2CCspKUWnVf", "name": "mcp__openpixel__get_model_info", "input": {}, "caller": {"type": "direct"}}}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49", "parent_tool_use_id": null}
{"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": ""}}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49", "parent_tool_use_id": null}
{"type": "assistant", "message": {"model": "claude-haiku-5-5", "id": "msg_011ChF459c1AmmT7ENLoZ4gu", "type": "message", "role": "assistant", "content": [{"type": "tool_use", "id": "toolu_01YbTBCLLFcqu2CCspKUWnVf", "name": "mcp__openpixel__get_model_info", "input": {}, "caller": {"type": "direct"}}], "stop_reason": null}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49"}
{"type": "stream_event", "event": {"type": "content_block_stop", "index": 0}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49"}
{"type": "stream_event", "event": {"type": "message_stop"}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49"}
{"type": "user", "message": {"role": "user", "content": [{"tool_use_id": "toolu_01YbTBCLLFcqu2CCspKUWnVf", "type": "tool_result", "content": [{"type": "text", "text": "{\n  \"active_frame\" : 0,\n  \"active_layer\" : 0"}]}]}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49"}
{"type": "stream_event", "event": {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49"}
{"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "I chec"}}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49"}
{"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "ked the model"}}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49"}
{"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": " info."}}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49"}
{"type": "assistant", "message": {"model": "claude-haiku-5-5", "id": "msg_011ChF45D9KaZ9eLSUi6r5s6", "type": "message", "role": "assistant", "content": [{"type": "text", "text": "I checked the model info."}], "stop_reason": null}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49"}
{"type": "stream_event", "event": {"type": "message_stop"}, "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49"}
{"type": "result", "subtype": "success", "is_error": false, "duration_ms": 3485, "result": "I checked the model info.", "session_id": "17646487-af0c-4c6c-b565-9f36fbf0bd49", "total_cost_usd": 0.0049}
`,
    expect: ["session", "tool get_model_info", "ok get_model_info", "text:I checked the model info.", "done"] },
  { name: "thinking, a failed tool and an error result (documented: Anthropic stream events, tool_result is_error)", provider: "claude-code", lines: String.raw`
{"type": "system", "subtype": "init", "session_id": "s-2", "model": "claude-opus-5-5"}
{"type": "stream_event", "event": {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}}}
{"type": "stream_event", "event": {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Check the palette first."}}}
{"type": "stream_event", "event": {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "toolu_2", "name": "mcp__openpixel__set_pixels", "input": {}}}}
{"type": "assistant", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_2", "name": "mcp__openpixel__set_pixels", "input": {"pixels": [[0, 0, 1]]}}]}, "session_id": "s-2"}
{"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_2", "is_error": true, "content": "colour 99 is not in the palette"}]}, "session_id": "s-2"}
{"type": "result", "subtype": "error_during_execution", "is_error": true, "result": "", "session_id": "s-2"}
`,
    expect: ["session", "think", "tool set_pixels", "failed set_pixels", "error: Claude stopped with an error.", "done failed"] },
  { name: "quits without a result", provider: "claude-code", lines: '',
    expect: ["error: The agent quit (exit code 1).", "done failed"], exitStatus: 1 },
];

// MARK: - Cursor (cursor-agent -p --output-format stream-json --stream-partial-output)
const cursor: Case[] = [
  { name: "docs example: whole messages, read and write tools (documented verbatim: cursor.com/docs/cli/reference/output-format)", provider: "cursor", lines: String.raw`
{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/Users/user/project","session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff","model":"Claude 4 Sonnet","permissionMode":"default"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Read README.md and create a summary"}]},"session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I'll read the README.md file"}]},"session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff"}
{"type":"tool_call","subtype":"started","call_id":"toolu_vrtx_01NnjaR886UcE8whekg2MGJd","tool_call":{"readToolCall":{"args":{"path":"README.md"}}},"session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff"}
{"type":"tool_call","subtype":"completed","call_id":"toolu_vrtx_01NnjaR886UcE8whekg2MGJd","tool_call":{"readToolCall":{"args":{"path":"README.md"},"result":{"success":{"content":"# Project\n\nThis is a sample project...","isEmpty":false,"exceededLimit":false,"totalLines":54,"totalChars":1254}}}},"session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Based on the README, I'll create a summary"}]},"session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff"}
{"type":"tool_call","subtype":"started","call_id":"toolu_vrtx_01Q3VHVnWFSKygaRPT7WDxrv","tool_call":{"writeToolCall":{"args":{"path":"summary.txt","fileText":"# README Summary\n\nThis project contains...","toolCallId":"toolu_vrtx_01Q3VHVnWFSKygaRPT7WDxrv"}}},"session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff"}
{"type":"tool_call","subtype":"completed","call_id":"toolu_vrtx_01Q3VHVnWFSKygaRPT7WDxrv","tool_call":{"writeToolCall":{"args":{"path":"summary.txt","fileText":"# README Summary\n\nThis project contains...","toolCallId":"toolu_vrtx_01Q3VHVnWFSKygaRPT7WDxrv"},"result":{"success":{"path":"/Users/user/project/summary.txt","linesCreated":19,"fileSize":942}}}},"session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done! I've created the summary in summary.txt"}]},"session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff"}
{"type":"result","subtype":"success","duration_ms":5234,"duration_api_ms":5234,"is_error":false,"result":"I'll read the README.md fileBased on the README, I'll create a summaryDone! I've created the summary in summary.txt","session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff","request_id":"10e11780-df2f-45dc-a1ff-4540af32e9c0"}
`,
    expect: ["session", "text:I'll read the README.md file", "tool read", "ok read", "text:Based on the README, I'll create a summary", "tool write", "ok write", "text:Done! I've created the summary in summary.txt", "done"] },
  { name: "OpenPixel tools, a rejected call, repeated text skipped (documented: built from the 2026.01.23 CLI source, headless.ts / McpResult)", provider: "cursor", lines: String.raw`
{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/x","session_id":"S","model":"Claude 4 Sonnet","permissionMode":"default"}
{"type":"thinking","subtype":"delta","text":"Let me draw","session_id":"S","timestamp_ms":1}
{"type":"thinking","subtype":"completed","session_id":"S","timestamp_ms":2}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Drawing"}]},"session_id":"S","timestamp_ms":3}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":" now."}]},"session_id":"S","timestamp_ms":4}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Drawing now."}]},"session_id":"S","model_call_id":"M","timestamp_ms":5}
{"type":"tool_call","subtype":"started","call_id":"C1","tool_call":{"mcpToolCall":{"args":{"name":"openpixel-set_pixels","args":{"x":1,"y":2,"color":"#ff0000"},"toolCallId":"C1","providerIdentifier":"openpixel","toolName":"set_pixels"}}},"model_call_id":"M","session_id":"S","timestamp_ms":6}
{"type":"tool_call","subtype":"completed","call_id":"C1","tool_call":{"mcpToolCall":{"args":{"name":"openpixel-set_pixels","args":{"x":1,"y":2,"color":"#ff0000"},"toolCallId":"C1","providerIdentifier":"openpixel","toolName":"set_pixels"},"result":{"success":{"content":[{"text":{"text":"ok"}}],"isError":false}}}},"model_call_id":"M","session_id":"S","timestamp_ms":7}
{"type":"tool_call","subtype":"started","call_id":"C2","tool_call":{"mcpToolCall":{"args":{"name":"openpixel-review_model","args":{},"toolCallId":"C2","providerIdentifier":"openpixel","toolName":"review_model"}}},"session_id":"S","timestamp_ms":8}
{"type":"tool_call","subtype":"completed","call_id":"C2","tool_call":{"mcpToolCall":{"args":{"name":"openpixel-review_model","args":{},"toolCallId":"C2","providerIdentifier":"openpixel","toolName":"review_model"},"result":{"success":{"content":[{"text":{"text":"bad"}}],"isError":true}}}},"session_id":"S","timestamp_ms":9}
{"type":"tool_call","subtype":"started","call_id":"C3","tool_call":{"mcpToolCall":{"args":{"name":"openpixel-clear","args":{},"toolCallId":"C3","providerIdentifier":"openpixel","toolName":"clear"}}},"session_id":"S","timestamp_ms":10}
{"type":"tool_call","subtype":"completed","call_id":"C3","tool_call":{"mcpToolCall":{"args":{"name":"openpixel-clear","args":{},"toolCallId":"C3","providerIdentifier":"openpixel","toolName":"clear"},"result":{"rejected":{"reason":"User rejected MCP: openpixel-clear","isReadonly":false}}}},"session_id":"S","timestamp_ms":11}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done."}]},"session_id":"S","timestamp_ms":12}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done."}]},"session_id":"S"}
{"type":"result","subtype":"success","duration_ms":10,"duration_api_ms":10,"is_error":false,"result":"Drawing now.Done.","session_id":"S"}
`,
    expect: ["session", "think", "text:Drawing now.", "tool set_pixels", "ok set_pixels", "tool review_model", "failed review_model", "tool clear", "failed clear", "text:Done.", "done"] },
  { name: "signed out: the error comes on stderr (documented: chat.ts pre-check)", provider: "cursor", lines: '',
    expect: ["error: Cursor's agent isn't signed in. Choose Sign in to Cursor… in the agent menu, then send again.", "done failed"], exitStatus: 1,
    stderr: "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.\n" },
];

// MARK: - Codex (recorded: codex exec --json, codex-cli 0.167)
const codex: Case[] = [
  { name: "tool calls with \"error\": null succeed (recorded)", provider: "codex", lines: String.raw`
{"type": "thread.started", "thread_id": "01a1fb7a-69af-72b0-9d59-e1c54768d25f"}
{"type": "turn.started"}
{"type": "item.completed", "item": {"id": "item_0", "type": "agent_message", "text": "I’ll inspect the model."}}
{"type": "item.started", "item": {"id": "item_1", "type": "mcp_tool_call", "server": "openpixel", "tool": "get_model_info", "arguments": {}, "result": null, "error": null, "status": "in_progress"}}
{"type": "item.completed", "item": {"id": "item_1", "type": "mcp_tool_call", "server": "openpixel", "tool": "get_model_info", "arguments": {}, "result": {"content": [{"type": "text", "text": "{\n  \"active_frame\" : 0"}], "structured_content": null}, "error": null, "status": "completed"}}
{"type": "item.completed", "item": {"id": "item_2", "type": "reasoning", "text": ""}}
{"type": "item.completed", "item": {"id": "item_3", "type": "agent_message", "text": "It is a 16×16 sprite."}}
{"type": "turn.completed", "usage": {"input_tokens": 77313, "cached_input_tokens": 64896, "output_tokens": 155}}
`,
    expect: ["session", "text:I’ll inspect the model.", "tool get_model_info", "ok get_model_info", "text:It is a 16×16 sprite.", "done"] },
  { name: "a failed call and a failed turn (documented: codex exec JSONL, McpToolCallItem / TurnFailed)", provider: "codex", lines: String.raw`
{"type": "thread.started", "thread_id": "t-2"}
{"type": "item.started", "item": {"id": "item_0", "type": "mcp_tool_call", "server": "openpixel", "tool": "set_pixels", "arguments": {"pixels": []}, "result": null, "error": null, "status": "in_progress"}}
{"type": "item.completed", "item": {"id": "item_0", "type": "mcp_tool_call", "server": "openpixel", "tool": "set_pixels", "arguments": {"pixels": []}, "result": null, "error": {"message": "bad colour"}, "status": "failed"}}
{"type": "item.completed", "item": {"id": "item_1", "type": "reasoning", "text": "Retry with a palette index."}}
{"type": "item.started", "item": {"id": "item_2", "type": "command_execution", "command": "ls", "aggregated_output": "", "exit_code": null, "status": "in_progress"}}
{"type": "item.completed", "item": {"id": "item_2", "type": "command_execution", "command": "ls", "aggregated_output": "a.txt\n", "exit_code": 0, "status": "completed"}}
{"type": "turn.failed", "error": {"message": "usage limit reached"}}
`,
    expect: ["session", "tool set_pixels", "failed set_pixels", "think", "tool shell", "ok shell", "error: usage limit reached", "done failed"] },
];

export const cases: Case[] = [...claude, ...codex, ...cursor, ...gemini, ...copilot, ...opencode, ...kiro, ...goose, ...cline, ...hermes];
