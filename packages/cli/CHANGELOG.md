# @prefactor/cli

## 0.2.1

### Patch Changes

- Updated dependencies [[`f768847`](https://github.com/prefactordev/typescript-sdk/commit/f768847fa1d1c79a239553cb7e8cf1111554da49), [`83a3c2f`](https://github.com/prefactordev/typescript-sdk/commit/83a3c2f36366be0021dba16d90799a9ec9e3b782)]:
  - @prefactor/core@1.0.0

## 0.2.0

### Minor Changes

- [#57](https://github.com/prefactordev/typescript-sdk/pull/57) [`cbd9aa0`](https://github.com/prefactordev/typescript-sdk/commit/cbd9aa0586893a57b7cb16a04df47da2e89c2d28) Thanks [@Siutan](https://github.com/Siutan)! - Add agent create options, token validation, and JSON output to `prefactor setup`. Setup prints credentials only; package selection is left to the caller.

## 0.1.6

### Patch Changes

- [#53](https://github.com/prefactordev/typescript-sdk/pull/53) [`61f85dd`](https://github.com/prefactordev/typescript-sdk/commit/61f85dd4432a56658e267beca43d126f1634a07d) Thanks [@Siutan](https://github.com/Siutan)! - Stop creating agent deployments manually in `prefactor setup`. Setup now resolves an environment and creates a deployment-scoped token; the backend creates the deployment when the token is issued if one does not already exist.

## 0.1.5

### Patch Changes

- [#54](https://github.com/prefactordev/typescript-sdk/pull/54) [`f74b890`](https://github.com/prefactordev/typescript-sdk/commit/f74b890de563becb24f3f3e4c74acf43a1b045d8) Thanks [@Siutan](https://github.com/Siutan)! - Add package `repository` metadata so npm provenance validation succeeds on publish.

- Updated dependencies [[`f74b890`](https://github.com/prefactordev/typescript-sdk/commit/f74b890de563becb24f3f3e4c74acf43a1b045d8)]:
  - @prefactor/core@0.5.1

## 0.1.4

### Patch Changes

- Updated dependencies [[`0e9b675`](https://github.com/prefactordev/typescript-sdk/commit/0e9b67519e6a538d9cf09218e75e006387f917b8)]:
  - @prefactor/core@0.5.0
