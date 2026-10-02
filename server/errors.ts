export class DomainError extends Error {
  constructor(
    readonly code: 'validation' | 'not_found' | 'conflict' | 'capability_not_supported',
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super('validation', message);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super('not_found', message);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super('conflict', message);
  }
}

export class CapabilityNotSupportedError extends DomainError {
  constructor(message: string) {
    super('capability_not_supported', message);
  }
}
