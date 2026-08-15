#!/usr/bin/env python3
"""
Deterministic PTY end-to-end driver for the dsh tui surface.

Drives `dsh --profile tui` against the harness mock LLM server, types
char-by-char like a real keyboard, and asserts:

  1. the banner renders,
  2. a submitted message reaches the agent and the streamed mock reply renders,
  3. `/quit` exits the process with code 0,
  4. the session is persisted (jsonl exists and contains the exchange),
  5. `--resume <id>` replays the history into the first render.

Usage: python3 scripts/e2e-pty.py [--no-resume]
"""

import json
import os
import pty
import re
import select
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

DSH_HOME = Path(os.environ.get("DSH_HOME", str(Path.home() / ".dsh")))
WORKSPACE = "/Users/mcswift/private/DeepSeek-TUI"
MOCK_BASE = "http://127.0.0.1:8765/v1"
MOCK_KEY = "mock-key"

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")
CR = re.compile(r"\r")


def plain(data: str) -> str:
    return CR.sub("", ANSI.sub("", data))


class TuiProcess:
    def __init__(self, args: list[str], base_url: str = MOCK_BASE, env_extra: dict[str, str] | None = None):
        env = {
            **os.environ,
            "DEEPSEEK_BASE_URL": base_url,
            "DEEPSEEK_API_KEY": MOCK_KEY,
            **(env_extra or {}),
        }
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(WORKSPACE)
            os.execvpe(
                "/opt/homebrew/bin/pnpm",
                ["pnpm", "--dir", "/Users/mcswift/private/deepseek-harness", "dsh", "--profile", "tui", *args],
                env,
            )
        self.out = b""
        self.exit_code = None
        self.eof = False
        # A real terminal drains the pty continuously. Without this, the
        # kernel pty output buffer fills during the driver's sleep()/type()
        # gaps (spinners re-render frames nonstop), the child's write() blocks
        # the event loop, and the throttled pty DROPS input bytes — observed
        # as lost keys ("/" of "/quit", digits in dialogs). Drain from a
        # daemon thread so reads never stall while the scenario sleeps.
        # The fd MUST be non-blocking for the drain: two threads (drain +
        # wait_for/wait_exit pumps) can both select-ready on the same final
        # chunk, and a blocking read() then waits forever for data the other
        # thread already consumed — a random permanent hang.
        os.set_blocking(self.fd, False)
        self._drainStop = False
        self._drainThread = threading.Thread(target=self._drainLoop, daemon=True)
        self._drainThread.start()

    def _drainLoop(self) -> None:
        while not self._drainStop and not self.eof:
            self.pump(0.05)

    def pump(self, timeout: float) -> None:
        ready, _, _ = select.select([self.fd], [], [], timeout)
        if ready:
            try:
                chunk = os.read(self.fd, 65536)
            except BlockingIOError:
                # Non-blocking fd: another thread (the drain) consumed the
                # readable data between select and read. Nothing to do.
                return
            except OSError:
                # Child closed the pty: EOF. Never waitpid on macOS here — a
                # zombie child can block os.waitpid even with WNOHANG.
                self.eof = True
                chunk = b""
            if chunk:
                self.out += chunk

    def type(self, text: str, gap: float = 0.015) -> None:
        # Escape sequences must reach the pty as ONE write: pi's StdinBuffer
        # coalesces them with a ~10ms timeout, and per-byte gaps would split
        # `\x1b[B` into an ESC key plus literal "[B" text.
        i = 0
        while i < len(text):
            if text[i] == '\x1b' and i + 1 < len(text):
                j = i + 1
                while j < len(text) and text[j] not in '\r\n\x1b':
                    j += 1
                os.write(self.fd, text[i:j].encode())
                i = j
                continue
            os.write(self.fd, text[i].encode())
            i += 1
            time.sleep(gap)

    def wait_for(self, needle: str, timeout: float) -> bool:
        # Single-reader model: the drain thread owns the fd, so frames can
        # never interleave out of order (two concurrent reads used to append
        # chunks in racy order and intermittently hid mid-frame text).
        deadline = time.time() + timeout
        while time.time() < deadline:
            if needle in plain(self.out.decode("utf-8", "replace")):
                return True
            time.sleep(0.05)
        return False

    def wait_exit(self, timeout: float) -> int:
        deadline = time.time() + timeout
        # waitpid can block indefinitely on some macOS child states; reap from
        # a daemon worker so the deadline below is never hostage to it.
        reap: dict[str, object] = {}
        def worker() -> None:
            while reap.get('done') is not True:
                try:
                    done, status = os.waitpid(self.pid, os.WNOHANG)
                except (ChildProcessError, OSError):
                    reap['done'] = True
                    reap['status'] = 0
                    return
                if done:
                    reap['done'] = True
                    reap['status'] = status
                    return
                time.sleep(0.05)
        threading.Thread(target=worker, daemon=True).start()
        while time.time() < deadline:
            # The drain thread owns the fd; only the reap state is polled.
            if reap.get('done') is True:
                self.exit_code = os.waitstatus_to_exitcode(int(reap['status']))
                return self.exit_code
            # Fallback: pty EOF also proves the child is gone.
            if self.eof:
                self.exit_code = 0
                return 0
        raise TimeoutError("process did not exit")

    def kill(self) -> None:
        self._drainStop = True
        try:
            os.kill(self.pid, signal.SIGKILL)
        except (ProcessLookupError, ChildProcessError):
            pass
        try:
            os.waitpid(self.pid, os.WNOHANG)
        except (ProcessLookupError, ChildProcessError, OSError):
            pass


def latest_session(marker: str, poll_s: float = 10.0, home: Path = DSH_HOME) -> Path | None:
    """The TUI session from this run: a small recent log carrying the marker
    and the mock reply. (The driving agent's own long-lived session shares
    `$DSH_HOME/sessions`, so size and content discriminate.)"""
    deadline = time.time() + poll_s
    while True:
        candidates = []
        for session_file in (home / "sessions").rglob("session.jsonl.zstd"):
            if time.time() - session_file.stat().st_mtime > 300:
                continue
            try:
                events = read_session(session_file)
            except Exception:
                continue
            if len(events) > 200:
                continue
            user, assistant = session_texts(events)
            if marker in user and "mock response recovered" in assistant:
                candidates.append((session_file.stat().st_mtime, session_file))
        if candidates:
            candidates.sort(reverse=True)
            return candidates[0][1]
        if time.time() >= deadline:
            return None
        time.sleep(0.5)


def read_session(path: Path) -> list[dict]:
    raw = subprocess.run(["zstd", "-dc", str(path)], capture_output=True).stdout.decode("utf-8", "replace")
    return [json.loads(line) for line in raw.splitlines() if line.strip()]


def session_texts(events: list[dict]) -> tuple[str, str]:
    user = ""
    assistant = ""
    for event in events:
        if event.get("type") == "user/message":
            for block in event.get("data", {}).get("content", []):
                if block.get("type") == "text":
                    user += block.get("text", "")
        if event.get("type") == "assistant/message":
            for block in event.get("data", {}).get("message", {}).get("content", []):
                if block.get("type") == "text":
                    assistant += block.get("text", "")
    return user, assistant


HARNESS = "/Users/mcswift/private/deepseek-harness"
FIXTURES = Path(__file__).parent / "fixtures"
HOOKS_CONFIG = "/tmp/dsh-tui-e2e-hooks.json"
PATCH_OVERLAY = str(FIXTURES / "e2e-approval-patch.yml")

def ensure_approval_fixtures() -> None:
    """Write the hook config and make the hook plugin resolvable from the profile."""
    (FIXTURES / "e2e-hooks.json").read_text() and Path(HOOKS_CONFIG).write_text(
        (FIXTURES / "e2e-hooks.json").read_text()
    )
    profile_modules = DSH_HOME / "profiles" / "tui" / "node_modules"
    if not (profile_modules / "@deepseek-ai" / "dsh-hooks-claude-code").exists():
        subprocess.run(
            ["pnpm", "--dir", HARNESS, "dsh", "plugin", "--profile", "tui",
             "add", f"link:{HARNESS}/packages/hooks/hooks-claude-code"],
            check=True, capture_output=True,
        )

def start_mock(port: int, sequence: str, tool_name: str | None = None, tool_arguments: str | None = None) -> subprocess.Popen:
    """One mock LLM server per scenario with scripted tool calls."""
    # Never let a stale process own the port: its exhausted sequence would
    # silently serve plain text instead of the scripted tool call.
    subprocess.run(["pkill", "-f", f"llm-mock-server.*--port {port}"], capture_output=True)
    time.sleep(1)
    args = ["node", "--import", "tsx/esm",
            "packages/test-support/llm-mock-server/src/bin.ts",
            "--port", str(port), "--api-key", MOCK_KEY, "--sequence", sequence, "--repeat-last"]
    if tool_name is not None:
        args += ["--tool-name", tool_name, "--tool-arguments", tool_arguments or "{}"]
    if os.environ.get("MOCK_LOGS") == "1":
        proc = subprocess.Popen(args, cwd=HARNESS)
    else:
        proc = subprocess.Popen(args, cwd=HARNESS, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    return proc

E2E_HOME = "/tmp/dsh-tui-e2e-home"
CORE_HOME = "/tmp/dsh-tui-e2e-core-home"

def ensure_core_home() -> None:
    """An isolated home for the core/persistence/resume scenarios: the user's
    live sessions share the real home, and concurrent writes there were
    observed to intermittently lose persistence events (see DESIGN.md §10)."""
    home = Path(CORE_HOME)
    profile = home / "profiles" / "tui"
    if (profile / "package.json").exists():
        return
    env = {**os.environ, "DSH_HOME": CORE_HOME}
    subprocess.run(
        ["/opt/homebrew/bin/pnpm", "--dir", HARNESS, "dsh", "plugin", "--profile", "tui", "add", f"link:{WORKSPACE}"],
        check=True, capture_output=True, env=env,
    )


def ensure_e2e_home() -> None:
    """An isolated harness home for the approval scenario: no user settings,
    so the inferred default preset (workspace-write) asks for approval."""
    home = Path(E2E_HOME)
    profile = home / "profiles" / "tui"
    if (profile / "package.json").exists():
        return
    env = {**os.environ, "DSH_HOME": E2E_HOME}
    subprocess.run(
        ["/opt/homebrew/bin/pnpm", "--dir", HARNESS, "dsh", "plugin", "--profile", "tui", "add", f"link:{WORKSPACE}"],
        check=True, capture_output=True, env=env,
    )
    subprocess.run(
        ["/opt/homebrew/bin/pnpm", "--dir", HARNESS, "dsh", "plugin", "--profile", "tui",
         "add", f"link:{HARNESS}/packages/hooks/hooks-claude-code"],
        check=True, capture_output=True, env=env,
    )

def scenario_approval() -> None:
    """Permission approval: a PreToolUse hook asks on bash; the dialog lets it through."""
    marker = f"e2e-approve-{int(time.time())}"
    ensure_approval_fixtures()
    ensure_e2e_home()
    mock = start_mock(8771, "tool_call_success,success", "bash",
                      '{"command":"echo approved-by-e2e","description":"e2e approval run"}')
    tui = TuiProcess(["--patch", PATCH_OVERLAY], base_url="http://127.0.0.1:8771/v1",
                     env_extra={"DSH_HOME": E2E_HOME, "DSH_TUI_DEBUG": "1"})
    try:
        assert tui.wait_for("dsh tui", 30), "approval: banner did not render"
        tui.type(f"run it {marker}\r")
        assert tui.wait_for("Approve tool call: bash?", 60), "approval dialog did not open"
        assert "Allow once" in plain(tui.out.decode("utf-8", "replace")), "approval options missing"
        tui.type("\r")  # pick the first option: Allow once
        assert tui.wait_for("approved-by-e2e", 60), "approved bash output did not render"
        if not tui.wait_for("allowed", 30):
            print("[e2e-approval] audit missing, last output:")
            dump = plain(tui.out.decode("utf-8", "replace"))
            print(dump[-16000:])
            print("[e2e-approval] last events:")
            print("\n".join(line for line in dump.splitlines() if "dsh tui event" in line)[-14000:])
            raise AssertionError("approval audit record missing")
        # The turn only ends after the model's post-tool reply; quit must not
        # be typed while the composer is still disabled.
        assert tui.wait_for("mock response recovered", 60), "post-tool reply missing"
        time.sleep(2)
        tui.type("/quit\r")
        assert tui.wait_exit(30) == 0, "approval scenario quit failed"
        print("[e2e] approval: dialog allowed the bash call and recorded the audit")
    finally:
        tui.kill()
        mock.terminate()

def scenario_questions() -> None:
    """Decision form: single-select, free-text, multi-select and skipped
    questions (C2: progress, multiSelect, skip/back parity)."""
    marker = f"e2e-question-{int(time.time())}"
    ensure_approval_fixtures()
    mock = start_mock(8772, "tool_call_success,success", "ask_user_question",
                      '{"questions":[{"id":"q1","question":"Which color?","options":[{"label":"red"},{"label":"blue"}]},{"id":"q2","question":"What is your name?"},{"id":"q3","question":"Pick flavors","multi_select":true,"options":[{"label":"vanilla"},{"label":"chocolate"},{"label":"strawberry"}]},{"id":"q4","question":"Skip me?","options":[{"label":"yes"},{"label":"no"}]}]}')
    tui = TuiProcess(["--patch", PATCH_OVERLAY], base_url="http://127.0.0.1:8772/v1",
                     env_extra={"DSH_TUI_DEBUG": "1", "DSH_HOME": E2E_HOME})
    try:
        if not tui.wait_for("dsh tui", 30):
            print("[e2e-questions] BANNER TIMEOUT, last output:")
            print(plain(tui.out.decode("utf-8", "replace"))[-2500:])
            raise AssertionError("questions: banner did not render")
        tui.type(f"ask me {marker}\r")
        # q1: single-select with progress (1 / 4).
        assert tui.wait_for("Which color?", 60), "option question dialog did not open"
        screen = plain(tui.out.decode("utf-8", "replace"))
        assert "red" in screen and "blue" in screen, "question options missing"
        assert "1 / 4" in screen, "question progress (1 / 4) missing"
        tui.type("\r")  # pick the first option: red
        # q2: free-text question — the dialog shows an input line.
        assert tui.wait_for("What is your name?", 60), "free-text question dialog did not open"
        assert "2 / 4" in plain(tui.out.decode("utf-8", "replace")), "question progress (2 / 4) missing"
        tui.type("xiaoming\r")
        # q3: multi-select — numbers toggle, Enter confirms the set.
        assert tui.wait_for("Pick flavors", 60), "multi-select question dialog did not open"
        assert "3 / 4" in plain(tui.out.decode("utf-8", "replace")), "question progress (3 / 4) missing"
        tui.type("1")   # toggle vanilla
        tui.type("3")   # toggle strawberry
        time.sleep(0.5)
        assert "☑" in plain(tui.out.decode("utf-8", "replace")), "multi-select toggles did not mark"
        tui.type("\r")  # confirm the set
        # q4: skip it via the footer entry (down past the options and 上一题).
        assert tui.wait_for("Skip me?", 60), "skip question dialog did not open"
        screen = plain(tui.out.decode("utf-8", "replace"))
        assert "4 / 4" in screen, "question progress (4 / 4) missing"
        assert "跳过本题" in screen, "skip entry missing"
        tui.type("\x1b[B\x1b[B\x1b[B")  # down: yes → no → 上一题 → 跳过本题
        tui.type("\r")
        assert tui.wait_for("mock response recovered", 60), "agent did not continue after the answers"
        time.sleep(2)
        tui.type("/quit\r")
        try:
            assert tui.wait_exit(30) == 0, "questions scenario quit failed"
        except TimeoutError:
            print("[e2e-questions] TIMEOUT, last output:")
            print(plain(tui.out.decode("utf-8", "replace"))[-4000:])
            raise
        print("[e2e] questions: single/free-text/multi-select answered, one skipped with progress")
    finally:
        tui.kill()
        mock.terminate()

def scenario_interactions() -> None:
    """T3/T4 interactive features: search jump, fork points, /rate, palette."""
    def dump_failure(step: str) -> None:
        print(f"[e2e-interactions] FAILED at {step}, last output:")
        print(plain(tui.out.decode("utf-8", "replace"))[-4000:])
    ensure_e2e_home()
    mock = start_mock(8765, "success")
    tui = TuiProcess([], env_extra={"DSH_HOME": E2E_HOME})
    try:
        assert tui.wait_for("dsh tui", 30), "interactions: banner did not render"
        tui.type("hello interactions\r")
        assert tui.wait_for("mock response recovered", 60), "interactions: reply missing"
        time.sleep(1)
        # Ctrl+F → search dialog → query → results picker → Enter jumps+focuses.
        tui.type("\x06")
        if not tui.wait_for("搜索", 30):
            dump_failure("search dialog")
            raise AssertionError("search dialog did not open")
        tui.type("mock response\r")
        if not tui.wait_for("搜索结果", 30):
            dump_failure("search results")
            raise AssertionError("search results did not open")
        tui.type("\r")
        if not tui.wait_for("▸ 助手回复", 30):
            dump_failure("search jump")
            raise AssertionError("search jump did not focus the entry")
        # Ctrl+B → fork points over the assistant message (T3③).
        tui.type("\x02")
        if not tui.wait_for("分支点", 30):
            dump_failure("fork picker")
            raise AssertionError("fork picker did not open")
        tui.type("\x1b")
        time.sleep(0.5)
        # Ctrl+/ → command palette → filter to /rate → rate the focused reply.
        tui.type("\x1f")
        if not tui.wait_for("命令", 30):
            dump_failure("command palette")
            raise AssertionError("command palette did not open")
        tui.type("rate\r")
        if not tui.wait_for("评价最近回复", 30):
            dump_failure("rate dialog")
            raise AssertionError("rate dialog did not open")
        tui.type("\r")  # 👍 有用
        if not tui.wait_for("已记录反馈", 30):
            dump_failure("feedback notice")
            raise AssertionError("feedback notice missing")
        time.sleep(0.5)
        # Esc returns keyboard focus to the composer before quitting.
        tui.type("\x1b")
        time.sleep(0.5)
        tui.type("/quit\r")
        try:
            assert tui.wait_exit(30) == 0, "interactions quit failed"
        except TimeoutError:
            dump_failure("quit")
            raise
        print("[e2e] interactions: search, fork, rate, palette all worked")
    finally:
        tui.kill()
        mock.terminate()

def main() -> int:
    check_resume = "--no-resume" not in sys.argv
    marker = f"e2e-ping-{int(time.time())}"
    core_mock = start_mock(8765, "success")
    time.sleep(2)

    if "--only-core" in sys.argv:
        ensure_core_home()
        core_mock = start_mock(8765, "success")
        time.sleep(2)
        tui = TuiProcess([], env_extra={"DSH_TUI_DEBUG": "1", "DSH_HOME": CORE_HOME})
        try:
            if not tui.wait_for("dsh tui", 30):
                print("[e2e-core] BANNER FAILED, last output:")
                print(plain(tui.out.decode("utf-8", "replace"))[-6000:])
                raise AssertionError("banner did not render")
            tui.type("hello e2e-core\r")
            assert tui.wait_for("mock response recovered", 60), "mock reply did not render"
            time.sleep(2)
            tui.type("/quit\r")
            try:
                assert tui.wait_exit(30) == 0
            except TimeoutError:
                print("[e2e-core] TIMEOUT, last output:")
                print(plain(tui.out.decode("utf-8", "replace"))[-6000:])
                raise
            print("[e2e] core quit cleanly")
        finally:
            tui.kill()
            core_mock.terminate()
        return 0

    if "--only-approval" in sys.argv:
        try:
            scenario_approval()
        except AssertionError:
            print("[e2e-approval] FAILED — last outputs were captured by the scenario")
            raise
        return 0

    if "--only-questions" in sys.argv:
        scenario_questions()
        return 0

    # 1. fresh session, one turn, quit (isolated home: the user's live
    # sessions keep writing the real home and shared-root concurrency has
    # been observed to drop persistence events).
    ensure_core_home()
    tui = TuiProcess([], env_extra={"DSH_TUI_DEBUG": "1", "DSH_HOME": CORE_HOME})
    try:
        assert tui.wait_for("dsh tui", 30), "banner did not render"
        tui.type(f"hello {marker}\r")
        assert tui.wait_for("mock response recovered", 60), "mock reply did not render"
        # Injected workspace context renders as a compact system row, never as
        # a user chat message (T1③: the row labels the source, not the body).
        screen = plain(tui.out.decode("utf-8", "replace"))
        assert "注入 ·" in screen, "injected context row did not render"
        assert f"hello {marker}" in screen, "user message missing"
        time.sleep(2)  # let the turn settle (title generation)
        tui.type("/quit\r")
        try:
            code = tui.wait_exit(30)
        except TimeoutError:
            print("[e2e-core] TIMEOUT, last output:")
            print(plain(tui.out.decode("utf-8", "replace"))[-5000:])
            raise
        assert code == 0, f"expected exit 0, got {code}"
        print(f"[e2e] turn rendered and quit cleanly (exit {code})")
    finally:
        tui.kill()

    # 2. persistence
    session_path = latest_session(marker, home=Path(CORE_HOME))
    if session_path is None:
        print("[e2e] persistence check failed — core TUI tail:")
        print(plain(tui.out.decode("utf-8", "replace"))[-9000:])
        print("[e2e] last error-ish lines:")
        print("\n".join(line for line in plain(tui.out.decode("utf-8", "replace")).splitlines() if "Error" in line or "error" in line or "throw" in line or "exit" in line))
        print("[e2e] event trace:")
        print("\n".join(line for line in plain(tui.out.decode("utf-8", "replace")).splitlines() if "dsh tui event" in line))
        print("[e2e] quit trace:")
        print("\n".join(line for line in plain(tui.out.decode("utf-8", "replace")).splitlines() if "quit:" in line))
        print(f"[e2e] core exit code was: {tui.exit_code}")
        raise AssertionError("no persisted session found")
    events = read_session(session_path)
    user, assistant = session_texts(events)
    assert marker in user, f"persisted user message missing ({marker})"
    assert "mock response recovered" in assistant, "persisted assistant message missing"
    session_id = session_path.parent.name
    print(f"[e2e] persisted session {session_id} carries the exchange")

    if not check_resume:
        return 0

    # 3. resume: history replays into the first render
    tui = TuiProcess(["--resume", session_id], env_extra={"DSH_HOME": CORE_HOME})
    try:
        assert tui.wait_for("dsh tui", 30), "banner did not render on resume"
        assert tui.wait_for(marker, 30), "history did not replay into the resumed view"
        assert tui.wait_for("mock response recovered", 30), "resumed assistant history missing"
        tui.type("/quit\r")
        code = tui.wait_exit(30)
        assert code == 0, f"resume quit failed with {code}"
        print(f"[e2e] resume {session_id} replayed history and exited cleanly")
    finally:
        tui.kill()

    core_mock.terminate()

    # 4. permission approval end to end
    scenario_approval()

    # 5. decision form end to end
    scenario_questions()

    # 6. interactive features (search/fork/rate/palette)
    scenario_interactions()

    print("[e2e] ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
