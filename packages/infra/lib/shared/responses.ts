/**
 * Standardized API response helpers.
 * Previously 4 inconsistent error formats across handlers.
 * Now one pattern: { error, message, requestId? }
 */
import { APIGatewayProxyResultV2 } from 'aws-lambda';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function jsonResponse(statusCode: number, body: unknown, headers?: Record<string, string>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body),
  };
}

export function successResponse(body: unknown, headers?: Record<string, string>): APIGatewayProxyResultV2 {
  return jsonResponse(200, body, headers);
}

export function createdResponse(body: unknown, headers?: Record<string, string>): APIGatewayProxyResultV2 {
  return jsonResponse(201, body, headers);
}

export function errorResponse(
  statusCode: number,
  error: string,
  message: string,
  requestId?: string,
): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, { error, message, ...(requestId && { requestId }) });
}

export function validationError(message: string): APIGatewayProxyResultV2 {
  return errorResponse(400, 'ValidationError', message);
}

export function notFoundError(message: string): APIGatewayProxyResultV2 {
  return errorResponse(404, 'NotFound', message);
}

export function internalError(message: string, requestId?: string): APIGatewayProxyResultV2 {
  return errorResponse(500, 'InternalServerError', message, requestId);
}

/**
 * Extract authenticated user from API Gateway event.
 * Returns the user string or an error response.
 */
export function getAuthUser(event: { requestContext: { authorizer?: { lambda?: { user?: string } } } }): string | APIGatewayProxyResultV2 {
  const user = event.requestContext.authorizer?.lambda?.user;
  if (!user) {
    console.error('CRITICAL: User context missing from authorizer');
    return internalError('Authentication context missing');
  }
  return user;
}
