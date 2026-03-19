# Installing the desloppify skill
Use this when the user machine does not contain the desloppify CLI.

pip install --upgrade "desloppify[full]"
desloppify update-skill claude    # installs the full workflow guide — pick yours: claude, cursor, codex, copilot, droid, windsurf, gemini

Before scanning, check for directories that should be excluded (vendor, build output,
generated code, worktrees, etc.) and exclude obvious ones with `desloppify exclude <path>`.
Share any questionable candidates with the user before excluding.

desloppify scan --path .
desloppify next

--path is the directory to scan (use "." for the whole project, or "src/" etc).