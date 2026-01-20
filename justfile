# Build the SDK
build:
    bun run scripts/build.ts

# Run tests
test:
    bun test

# Watch tests
test-watch:
    bun test --watch

# Type check
typecheck:
    tsc --noEmit

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
    rm -rf dist node_modules

# Install dependencies
install:
    bun install
