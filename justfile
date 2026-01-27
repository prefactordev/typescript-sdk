# Build all packages
build:
    bun run scripts/build.ts

# Build specific package
build-core:
    bun run scripts/build.ts --filter @prefactor/core

build-langchain:
    bun run scripts/build.ts --filter @prefactor/langchain

build-ai:
    bun run scripts/build.ts --filter @prefactor/ai

# Run tests
test:
    bun test

# Watch tests
test-watch:
    bun test --watch

# Type check with project references
typecheck:
    tsc --build

# Lint code
lint:
    biome check .

# Format code
format:
    biome format --write .

# Run all checks
check: typecheck lint test

# Clean build artifacts
clean:
    rm -rf packages/*/dist node_modules

# Install dependencies
install:
    bun install

# Publish all packages (in dependency order)
publish:
    cd packages/core && bun publish --access public
    cd packages/langchain && bun publish --access public
    cd packages/ai && bun publish --access public

# Dry run publish
publish-dry:
    cd packages/core && bun publish --access public --dry-run
    cd packages/langchain && bun publish --access public --dry-run
    cd packages/ai && bun publish --access public --dry-run
