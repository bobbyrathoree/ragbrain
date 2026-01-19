/**
 * Standardized API response helpers for consistent response formatting
 */

import { ApiError, ErrorCode, internalError } from './errors';

/**
 * Lambda response structure (compatible with API Gateway)
 */
export interface LambdaResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
};

/**
 * Create a success response with standardized envelope
 */
export function successResponse<T>(
  data: T,
  statusCode = 200,
  headers?: Record<string, string>
): LambdaResponse {
  return {
    statusCode,
    headers: { ...DEFAULT_HEADERS, ...headers },
    body: JSON.stringify({
      success: true,
      data,
    }),
  };
}

/**
 * Create a success response for resource creation (201)
 */
export function createdResponse<T>(
  data: T,
  headers?: Record<string, string>
): LambdaResponse {
  return successResponse(data, 201, headers);
}

/**
 * Create an error response from an ApiError
 */
export function errorResponse(
  error: ApiError,
  headers?: Record<string, string>
): LambdaResponse {
  return {
    statusCode: error.statusCode,
    headers: { ...DEFAULT_HEADERS, ...headers },
    body: JSON.stringify({
      success: false,
      error: error.toJSON(),
    }),
  };
}

/**
 * Create an error response from code, message, and optional details
 */
export function errorResponseFromCode(
  code: ErrorCode,
  message: string,
  statusCode: number,
  details?: Record<string, unknown>,
  headers?: Record<string, string>
): LambdaResponse {
  return {
    statusCode,
    headers: { ...DEFAULT_HEADERS, ...headers },
    body: JSON.stringify({
      success: false,
      error: {
        code,
        message,
        ...(details && { details }),
      },
    }),
  };
}

/**
 * Handle any error and return appropriate API response
 */
export function handleError(
  error: unknown,
  headers?: Record<string, string>
): LambdaResponse {
  console.error('Error:', error);

  if (error instanceof ApiError) {
    return errorResponse(error, headers);
  }

  // Convert unknown errors to internal error
  const apiError = internalError(
    error instanceof Error ? error.message : 'An unexpected error occurred'
  );

  return errorResponse(apiError, headers);
}

/**
 * Utility to remove null/undefined values from an object (for clean responses)
 */
export function cleanResponse<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const cleaned: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      cleaned[key as keyof T] = value as T[keyof T];
    }
  }
  return cleaned;
}
