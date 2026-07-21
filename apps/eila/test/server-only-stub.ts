// vitest stub for the "server-only" guard package: in Next builds it errors
// when a server module leaks into client code; under vitest (plain node) it
// must be inert so server libs stay unit-testable.
export {};
