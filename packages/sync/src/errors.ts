export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented until Phase 2`);
    this.name = 'NotImplementedError';
  }
}

export class SyncError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}
