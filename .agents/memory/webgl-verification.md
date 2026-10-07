---
name: WebGL verification
description: Distinguishing capture-browser graphics limitations from game rendering failures.
---

The default screenshot browser can fail to create a WebGL context and show a blank page even when the game renders correctly.

**Why:** During import setup, the capture browser failed with BindToCurrentSequence errors, while Chromium using software rendering displayed the menu and globe correctly.

**How to apply:** When visual verification fails specifically at WebGL initialization, independently capture with Chromium using `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. Do not remove the globe or change the game's rendering stack just to accommodate a capture tool.
