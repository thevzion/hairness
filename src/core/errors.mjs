export class HairnessError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'HairnessError'
    this.code = code
    this.exitCode = options.exitCode ?? 3
    this.details = options.details ?? null
    this.limits = options.limits ?? []
    this.routes = options.routes ?? []
  }
}

export function asHairnessError(error) {
  if (error instanceof HairnessError) return error
  return new HairnessError('internal_error', error.message, {
    cause: error,
    exitCode: 5,
  })
}
