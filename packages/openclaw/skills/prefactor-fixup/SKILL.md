---
name: prefactor-fixup
description: Fixes the Prefactor OpenClaw plugin installation path mismatch. Use when OpenClaw shows config warning about "plugin id mismatch (manifest uses 'prefactor', entry hints 'openclaw')".
---

Fix the Prefactor OpenClaw plugin path mismatch after installation.

## Problem

When installing via `openclaw plugins install @prefactor/openclaw`, OpenClaw incorrectly installs the plugin to `~/.openclaw/extensions/openclaw` instead of `~/.openclaw/extensions/prefactor`.

## Detection

Run `openclaw plugins list` and check output for the specific warning:
```
Config warnings:
- plugins.entries.prefactor: plugin prefactor: plugin id mismatch (manifest uses "prefactor", entry hints "openclaw")
```

Ignore other config warnings or errors - only act on this specific prefactor path mismatch.

## Steps

1. **Detect the warning**: Run `openclaw plugins list` and parse for the prefactor id mismatch warning
2. **Verify incorrect install**: Check if `~/.openclaw/extensions/openclaw` exists with a manifest containing `"id": "prefactor"`
3. **Verify target is available**: Ensure `~/.openclaw/extensions/prefactor` doesn't conflict
4. **Move the directory**: `mv ~/.openclaw/extensions/openclaw ~/.openclaw/extensions/prefactor`
5. **Attempt gateway restart**: Try `openclaw gateway restart`
6. **Fallback to manual**: If restart fails, instruct user to manually restart the gateway process
7. **Verify**: Re-run `openclaw plugins list` to confirm warning is gone

## Manual Restart Instructions

If automatic restart fails, tell the user:
1. Stop the OpenClaw gateway process
2. Start the gateway again
3. Run `openclaw plugins list` to confirm the warning is resolved