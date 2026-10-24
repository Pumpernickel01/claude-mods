# /mods:explain-error

Paste an error or stack trace; Claude finds the cause in the current repo,
explains it in plain language, proposes one fix, and applies it only after
you answer "Yes".

## Use

```
/mods:explain-error <paste the error or stack trace>
```

Multi-line pastes work. With no argument it asks you to paste and stops.

What it does, in order: parses the trace (Python, Node/TS, Rust, Go,
Swift/Xcode, Java/Kotlin, C/C++ compiler and linker, shell), maps frames to
repo files (dependency frames such as `node_modules` or `site-packages` are
labelled as such; build prefixes like `dist/` are stripped), reads the lines
around the failure, greps for the symbol's definition and callers, explains
what / why / where and whether the cause is your code or a dependency, shows
one diff-like fix plus the command to re-run, then asks "Apply this fix?".
Only a Yes leads to an `Edit`, followed by re-running the failing command
when it is known.

## Disable

The skill is `disable-model-invocation: true`: Claude never runs it on its
own, so not typing `/mods:explain-error` is enough. To remove it entirely,
delete `skills/explain-error/` or disable the plugin (`/plugin`).
`CLAUDE_MODS_DISABLE` does not apply: there is no script for it to stop.

## Terminal.app vs Ghostty

No difference. It is a Markdown skill with no scripts, hooks, colours or
images.

## Permissions and packages

None. It uses the built-in Read, Grep, Edit, Bash and AskUserQuestion tools;
Edit and Bash go through your normal permission prompts. Files outside the
repo (`${CLAUDE_PROJECT_DIR}`) are never read or changed.
