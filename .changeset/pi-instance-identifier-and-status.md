---
"@prefactor/pi": patch
---

Let agents built on pi's SDK tie each session's agent instance to an outside run and say how the session ended. The new `externalIdentifier` option of `prefactorExtension()` sets the agent instance's external identifier, as a string for a process that runs one session or as a function called at each session start; Prefactor requires the identifier to be unique per agent. The session recorder's new `setFinishStatus()` sets whether the instance finishes as complete, failed or cancelled at session shutdown, and the instance still finishes as complete when nothing sets it. The `pi` command records exactly what it did before.
