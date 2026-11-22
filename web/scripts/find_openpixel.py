"""Where the website's art scripts find OpenPixel.

Two programs:

  program()      the native `openpixel` program, the MCP server agents start (`openpixel --mcp --headless`).
                 1. $OPENPIXEL, if set
                 2. core/target/release/openpixel in this repository, built by
                        cargo build --release --manifest-path core/Cargo.toml --bin openpixel
                 3. the copy inside the installed app:
                        macOS    /Applications/OpenPixel.app/Contents/Resources/core/openpixel
                        Windows  %LOCALAPPDATA%\\Programs\\OpenPixel\\resources\\core\\openpixel.exe
                        Linux    ~/.local/share/OpenPixel/bin/openpixel (the app puts it there when it starts)

  desktop_app()  the desktop app itself, only for editor screenshots (`OpenPixel --screenshot out.png file`).
                 1. $OPENPIXEL_APP, if set: a command line, e.g. "npx electron ." run from desktop/
                 2. the installed app
"""
import os
import shlex
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
WINDOWS = sys.platform.startswith("win")
BUILT = os.path.join(ROOT, "core", "target", "release", "openpixel.exe" if WINDOWS else "openpixel")


def installed():
    """The MCP program inside the installed app, whether or not it is there."""
    if sys.platform == "darwin":
        return "/Applications/OpenPixel.app/Contents/Resources/core/openpixel"
    if WINDOWS:
        local = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
        return os.path.join(local, "Programs", "OpenPixel", "resources", "core", "openpixel.exe")
    return os.path.expanduser("~/.local/share/OpenPixel/bin/openpixel")


def program():
    """The MCP program to start. When none is found this is still the repository's build, so the error names it."""
    chosen = os.environ.get("OPENPIXEL")
    if chosen:
        return chosen
    for path in (BUILT, installed()):
        if os.path.exists(path):
            return path
    return BUILT


def require(path):
    """Stops with what to do when the MCP program isn't there."""
    if os.path.exists(path) or shutil.which(path):
        return path
    raise SystemExit(
        f"OpenPixel's MCP program is not at {path}.\n"
        "Build it:  cargo build --release --manifest-path core/Cargo.toml --bin openpixel\n"
        "or install the app, or set OPENPIXEL to the program.")


def desktop_app():
    """The command that starts the desktop app (a list), or None when it isn't installed and $OPENPIXEL_APP isn't set."""
    chosen = os.environ.get("OPENPIXEL_APP")
    if chosen:
        return shlex.split(chosen, posix=not WINDOWS)
    if sys.platform == "darwin":
        path = "/Applications/OpenPixel.app/Contents/MacOS/OpenPixel"
    elif WINDOWS:
        local = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
        path = os.path.join(local, "Programs", "OpenPixel", "OpenPixel.exe")
    else:
        path = shutil.which("openpixel-desktop") or ""  # the .deb's command; an AppImage can be anywhere
    return [path] if path and os.path.exists(path) else None
