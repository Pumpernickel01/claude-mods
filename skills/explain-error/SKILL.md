---
name: explain-error
description: Explain a pasted error or stack trace, locate its cause in this repo, propose one fix, apply it only after the user says yes
disable-model-invocation: true
argument-hint: [paste the error or stack trace]
---

The error to explain:

$ARGUMENTS

If nothing was pasted above, ask the user to paste the error or stack trace and stop.
The repo is `${CLAUDE_PROJECT_DIR}`. Never Read, Grep or Edit anything outside it.

## 1. Parse the trace
Extract the language/toolchain, the error type and message, and for every frame the file path, line, and function.
Typical shapes: Python `File "x.py", line N, in f` · Node/TS `at f (x.ts:N:C)` · Rust `--> src/x.rs:N:C` ·
Go `x.go:N +0x..` · Swift/Xcode `x.swift:N:C: error:` · Java/Kotlin `at pkg.Cls.m(X.java:N)` ·
C/C++ `x.c:N:C: error:` or `undefined reference to` / `ld: symbol(s) not found` · shell `x.sh: line N:`.

## 2. Map frames to repo files
- Frames under `node_modules`, `site-packages`, `dist-packages`, `.cargo/registry`, `GOROOT`, `/usr/lib`,
  `/System`, `DerivedData`, `.gradle` are dependency code. Keep the FIRST frame that is in the user's own
  code; that is where to look first. Python traces list frames outermost-first, so take the last own-code frame.
- Strip build prefixes (`dist/`, `build/`, `out/`, `target/`, `.next/`, `__pycache__/`) and map compiled
  names to source (`.js` -> `.ts`, `.pyc` -> `.py`) when the source file exists.

## 3. Read and search
- Read the mapped file at the reported line, 20 lines before and after.
- Grep for the failing symbol's definition and its callers; Read the call site too.
- If every frame is dependency code, Grep the repo for the call into that dependency.

## 4. Explain
In plain language: what happened (one sentence), why (the condition in the code that triggers it),
where (`file:line`). Say whether the cause is in **your code** or in a **dependency** (wrong version,
misuse, not installed). If you are not sure, say so and name what would confirm it.

## 5. Propose ONE fix
The smallest concrete change, as a diff-like snippet with `file:line`, plus how to verify: the exact
command to re-run (take it from the trace or the context; if unknown, say so).

## 6. Ask, then wait
Use AskUserQuestion with the question "Apply this fix?" and options Yes / No. Wait for the answer.
- Anything other than a clear yes: stop. Do not edit.
- Yes: apply with Edit (repo files only), then re-run the failing command if it is known and report
  whether the error is gone.

Never apply a change without an explicit yes. Never touch files outside the repo. Fix only the cause
you explained; no refactoring around it.
