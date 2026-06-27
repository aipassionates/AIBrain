# Launcher for OpenBB MCP under PM2.
#
# Run with the REAL uv-managed CPython (not the uv-tool venv's python.exe, which is
# a uv trampoline that fails to canonicalize its path when spawned by PM2 on Windows:
# "uv trampoline failed to canonicalize script path"). We inject the tool venv's
# site-packages onto sys.path so all OpenBB deps resolve, with no trampoline involved.
import os
import site

VENV = r"C:\tools\openbb\venv"
SITE = os.path.join(VENV, "Lib", "site-packages")
# Use addsitedir (NOT sys.path.insert): it processes the venv's .pth files, which
# fastmcp/fastmcp-slim rely on. A bare sys.path.insert yields a misleading
# "FastMCP server support is not installed" ImportError.
site.addsitedir(SITE)

# pywin32 ships native DLLs in pywin32_system32; make them loadable.
_pw = os.path.join(SITE, "pywin32_system32")
if os.path.isdir(_pw):
    try:
        os.add_dll_directory(_pw)
    except OSError:
        pass
    os.environ["PATH"] = _pw + os.pathsep + os.environ.get("PATH", "")

from openbb_mcp_server.app.app import main

if __name__ == "__main__":
    main()
