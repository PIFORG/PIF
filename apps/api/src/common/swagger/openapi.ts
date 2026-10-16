import type { OpenAPIObject } from '@nestjs/swagger';

const ERROR_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['statusCode', 'message', 'errorCode'],
  properties: {
    statusCode: { type: 'integer', example: 400 },
    message: { type: 'string', example: 'Validation failed' },
    errorCode: { type: 'string', example: 'VALIDATION_ERROR' },
    details: { type: 'array', items: { type: 'string' } },
    correlationId: { type: 'string', example: '1f0c2a5e-6a4b-4c1e-9a55-2f1d1b8a7c3d' },
  },
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * Documents the error envelope every operation can return, so Swagger shows the real
 * failure modes (validation, auth, throttling, database outage) next to the success response.
 * Responses an operation already declares are kept.
 */
export function withStandardErrorResponses(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ErrorResponse = ERROR_RESPONSE_SCHEMA;

  const error = (description: string) => ({
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  });

  for (const pathItem of Object.values(document.paths)) {
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const responses = operation.responses;
      const add = (code: string, description: string) => {
        responses[code] ??= error(description);
      };
      const takesInput = Boolean(operation.requestBody) || (operation.parameters?.length ?? 0) > 0;
      const secured = (operation.security?.length ?? 0) > 0;

      if (takesInput) add('400', 'Validation failed (`VALIDATION_ERROR`; messages in `details`)');
      if (secured) {
        add('401', 'Missing, expired or revoked access token');
        add('403', 'Not permitted: role, account status, admin MFA policy or failed reauthentication');
      }
      add('429', 'Too many requests (`RATE_LIMITED`)');
      add('503', 'Database temporarily unavailable (`DATABASE_UNAVAILABLE`)');
    }
  }
  return document;
}
