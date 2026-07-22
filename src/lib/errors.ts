export class AlphaGateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
    public readonly fields: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export function errorPayload(error: unknown, requestId?: string) {
  if (error instanceof AlphaGateError) {
    return {
      status: error.status,
      body: {
        error: error.code,
        message: error.message,
        retryable: error.retryable,
        fields: error.fields,
        request_id: requestId
      }
    };
  }

  const message = error instanceof Error ? error.message : "Unexpected service failure";
  return {
    status: 500,
    body: {
      error: "request_failed",
      message,
      retryable: true,
      fields: {},
      request_id: requestId
    }
  };
}
