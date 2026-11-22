// How agents start OpenPixel's MCP server, shared by the downloads page and its Agents section.
// The server is the native `openpixel` program inside the installed app; where it sits differs by system.

import type { Os } from "@/lib/platforms";

/** The program's place on each system, as it is written in a terminal. */
export const MCP_PROGRAM: Record<Os, string> = {
  mac: "/Applications/OpenPixel.app/Contents/Resources/core/openpixel",
  // Quoted: the folder %LOCALAPPDATA% stands for holds the user's name, which may have spaces.
  windows: '"%LOCALAPPDATA%\\Programs\\OpenPixel\\resources\\core\\openpixel.exe"',
  linux: "~/.local/share/OpenPixel/bin/openpixel",
};

/** The command that starts the MCP server, with any more flags after it. */
export const mcpCommand = (os: Os, flags = "--mcp") => `${MCP_PROGRAM[os]} ${flags}`;

/**
 * What an MCP client's JSON settings need. Only for the Mac: these settings run the program directly, without a
 * shell, so nothing would fill in %LOCALAPPDATA% or ~. On Windows and Linux the Agents page in the app gives the
 * config with the full path for that computer.
 */
const MAC_CONFIG = { command: MCP_PROGRAM.mac, args: ["--mcp"] };
export const MAC_MCP_JSON = JSON.stringify({ mcpServers: { openpixel: MAC_CONFIG } }, null, 2);

/** Cursor's one-click MCP install link (the same one the app's Agents page uses), for the Mac's fixed path. */
export const MAC_CURSOR_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=openpixel&config=${encodeURIComponent(
  Buffer.from(JSON.stringify(MAC_CONFIG)).toString("base64"),
)}`;
