# Mise Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace devenv/direnv with a mise-managed toolchain while keeping the existing just-based workflow intact.

**Architecture:** Add `.mise.toml` for tool versions (node/bun/just), remove devenv/direnv files, update `justfile` to run local devDependencies via `bun run`, and update docs to reference mise instead of devenv/direnv.

**Tech Stack:** Bun, Node.js, just, mise, Biome, TypeScript.

---

### Task 1: Add mise toolchain config

**Files:**
- Create: `.mise.toml`

**Step 1: Create `.mise.toml`**

```toml
[tools]
node = "24"
bun = "latest"
just = "latest"
```

**Step 2: Commit toolchain config**

```bash
git add .mise.toml
git commit -m "chore: add mise toolchain config"
```

### Task 2: Remove devenv/direnv files

**Files:**
- Delete: `.envrc`
- Delete: `devenv.nix`
- Delete: `devenv.yaml`
- Delete: `devenv.lock`

**Step 1: Remove files from git**

```bash
git rm .envrc devenv.nix devenv.yaml devenv.lock
```

**Step 2: Commit removals**

```bash
git commit -m "chore: remove devenv and direnv files"
```

### Task 3: Update justfile to use local devDependencies

**Files:**
- Modify: `justfile`

**Step 1: Replace global tool invocations with `bun run`**

```make
typecheck:
    bun run tsc --build

lint:
    bun run biome check .

format:
    bun run biome format --write .
```

**Step 2: Commit justfile changes**

```bash
git add justfile
git commit -m "chore: run tsc/biome via bun"
```

### Task 4: Update documentation for mise

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `examples/anthropic-agent/README.md`

**Step 1: Update `README.md` development setup**

Replace the devenv mention with mise and add the setup commands:

```markdown
This project uses Bun with mise for development.

```bash
# Install toolchain
mise install

# Install dependencies (monorepo-wide)
just install
```
```

**Step 2: Update `CLAUDE.md` development environment**

Replace the devenv/direnv setup block with mise:

```markdown
This project uses **Bun** as the runtime, package manager, and test runner, with **mise** for toolchain management.

### Setup
```bash
# Install toolchain
mise install

# Install dependencies
just install
# or: bun install
```
```

**Step 3: Update `examples/anthropic-agent/README.md`**

Remove the devenv snippet and add a short note in Setup or Running section, for example:

```markdown
If using mise:

```bash
mise install
```
```

**Step 4: Commit documentation changes**

```bash
git add README.md CLAUDE.md examples/anthropic-agent/README.md
git commit -m "docs: update dev setup to mise"
```

### Task 5: Verification

**Files:**
- Test: `justfile`
- Test: `.mise.toml`

**Step 1: Build first (required)**

```bash
bun run build
```

Expected: build completes without errors.

**Step 2: Run checks**

```bash
just check
```

Expected: all checks pass. If existing failures persist, record them in the summary.
