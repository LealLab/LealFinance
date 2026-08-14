"""Local dev-server entrypoint (`task backend:dev`).

Not used in Docker or production - the Dockerfile's CMD invokes the
`uvicorn` CLI directly, and on Linux there's no event-loop distinction to
work around.

On native Windows, the `uvicorn` CLI creates its event loop (Proactor,
Windows' asyncio default) *before* importing the ASGI app string - so
app/main.py's own Windows event-loop-policy patch runs too late, and
psycopg's async driver fails with "cannot use the 'ProactorEventLoop'".
Running uvicorn in-process instead of via its CLI entrypoint fixes the
ordering: this script sets the policy first, so uvicorn.run()'s internal
asyncio.run() creates the loop with the already-correct policy.
"""

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn  # noqa: E402


def main() -> None:
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)


if __name__ == "__main__":
    main()
