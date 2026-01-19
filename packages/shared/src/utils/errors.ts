/**
 * Standardized error codes and ApiError class for consistent error handling
 */

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  CONFLICT = 'CONFLICT',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

export const ErrorStatusCodes: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

export interface ErrorDetails {
  field?: string;
  reason?: string;
  retryAfter?: number;
  limit?: number;
  remaining?: number;
  [key: string]: unknown;
}

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: ErrorDetails;

  constructor(
    code: ErrorCode,
    message: string,
    details?: ErrorDetails,
    statusCode?: number
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode ?? ErrorStatusCodes[code];
    this.details = details;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
    };
  }
}

// Convenience factory functions
export const validationError = (message: string, field?: string, reason?: string) =>
  new ApiError(ErrorCode.VALIDATION_ERROR, message, { field, reason });

export const notFoundError = (resource: string, id?: string) =>
  new ApiError(ErrorCode.NOT_FOUND, `${resource} not found`, id ? { [`${resource.toLowerCase()}Id`]: id } : undefined);

export const unauthorizedError = (message = 'Unauthorized') =>
  new ApiError(ErrorCode.UNAUTHORIZED, message);

export const rateLimitedError = (limit: number, remaining: number, retryAfter: number) =>
  new ApiError(ErrorCode.RATE_LIMITED, `Rate limit exceeded (${limit} requests/hour)`, {
    retryAfter,
    limit,
    remaining,
  });

export const internalError = (message = 'Internal server error') =>
  new ApiError(ErrorCode.INTERNAL_ERROR, message);

export const badRequestError = (message: string, details?: ErrorDetails) =>
  new ApiError(ErrorCode.BAD_REQUEST, message, details);
