#!/bin/bash
# Thin wrapper so settings.json can point here; stdin passes straight through to the Python.
exec python3 "$(cd "$(dirname "$0")" && pwd)/statusline.py"
