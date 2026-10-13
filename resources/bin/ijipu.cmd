@echo off
rem ===========================================================================
rem  ijipu.cmd -- the console shim. This is what gets put on the user PATH
rem  (the whole <install>\bin directory is registered, see envPath.ts).
rem
rem  WHY A .CMD SHIM AT ALL (adj946, user-reported bug):
rem    ijipu.exe is a GUI-subsystem binary (that is what keeps a double-click on
rem    a .jps from flashing a black console). cmd.exe does NOT wait for a GUI
rem    binary typed at the prompt: it prints the next prompt first, our output
rem    then lands AFTER that prompt, %ERRORLEVEL% keeps the previous command's
rem    value, and PowerShell's `> file` writes a 0-byte file.
rem    cmd.exe DOES wait for a batch file, so routing the command-line entry
rem    through this shim fixes output order, exit codes and redirection while
rem    the GUI binary stays a GUI binary.
rem
rem  WHY DIRECT INVOCATION AND NOT `start /wait` (measured 2026-10-14,
rem  Windows 11 26300.9457, cmd code page 936):
rem    `start /wait "" "..\ijipu.exe" %*` does wait and does forward the exit
rem    code, but it BREAKS redirection and pipes: `start` does not hand the
rem    redirected std handles to the child, so `ijipu cli lint x.jps > out.txt`
rem    leaves a 0-byte out.txt and the text is lost entirely.
rem    Measured side by side: direct call -> 89 bytes in the file, exit code 3;
rem    start /wait -> 0 bytes, exit code 3. Hence the direct call below.
rem
rem  WHY THE COMMENTS ARE ASCII-ONLY:
rem    cmd.exe parses .cmd files with the OEM code page (936 here). Chinese
rem    comments stored as UTF-8 can desynchronise the double-byte decoder on
rem    this and other DBCS code pages (932/949/950), and a broken shim breaks
rem    every command-line invocation. scripts/git-push.bat is ASCII-only for
rem    exactly the same reason. The Chinese rationale lives in docs/CLI.md.
rem
rem  HOW ARGUMENTS WORK (transparent, %* verbatim -- quotes are preserved):
rem    ijipu cli lint "a b.jps"  ->  <install>\ijipu.exe cli lint "a b.jps"
rem    The word `cli` is NOT added here on purpose: adding it would turn the
rem    documented form into `ijipu.exe cli cli lint ...` (measured: the CLI then
rem    answers `unknown command "cli"`), and a bare `ijipu my.jps` must keep
rem    opening the GUI exactly as before.
rem
rem  EXIT CODE: `exit /b %ERRORLEVEL%` forwards the child's code to the caller
rem    (cmd /c, a calling batch file, PowerShell's $LASTEXITCODE).
rem ===========================================================================
"%~dp0..\ijipu.exe" %*
exit /b %ERRORLEVEL%
