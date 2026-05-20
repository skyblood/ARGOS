export class AuthError extends Error {
  constructor(message = 'Veracode auth failed — check HMAC credentials') {
    super(message)
    this.name = 'AuthError'
  }
}

export class AuthConfigError extends Error {
  constructor(prefix: string) {
    super(`Missing env vars: ${prefix}_API_ID and ${prefix}_API_KEY must be set`)
    this.name = 'AuthConfigError'
  }
}

export class RateLimitError extends Error {
  constructor() {
    super('Veracode rate limit exceeded after 3 retries')
    this.name = 'RateLimitError'
  }
}

export class VeracodeError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`Veracode API error ${status}: ${message}`)
    this.name = 'VeracodeError'
  }
}

export class NotImplementedError extends Error {
  constructor(phase: string) {
    super(`Not implemented in ${phase}`)
    this.name = 'NotImplementedError'
  }
}
