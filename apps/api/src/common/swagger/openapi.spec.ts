import type { OpenAPIObject } from '@nestjs/swagger';
import { withStandardErrorResponses } from './openapi';

function doc(): OpenAPIObject {
  return {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths: {
      '/api/auth/login': {
        post: { requestBody: { content: {} }, responses: { '200': { description: 'ok' } } },
      },
      '/api/auth/me': {
        get: { security: [{ bearer: [] }], responses: { '200': { description: 'ok' } } },
      },
      '/api/health': {
        get: { responses: { '200': { description: 'ok' }, '503': { description: 'custom' } } },
      },
    },
  };
}

describe('withStandardErrorResponses', () => {
  const result = withStandardErrorResponses(doc());

  it('documents validation errors only where input is accepted', () => {
    expect(result.paths['/api/auth/login'].post?.responses['400']).toBeDefined();
    expect(result.paths['/api/auth/me'].get?.responses['400']).toBeUndefined();
  });

  it('documents 401/403 only on secured operations', () => {
    expect(result.paths['/api/auth/me'].get?.responses['401']).toBeDefined();
    expect(result.paths['/api/auth/me'].get?.responses['403']).toBeDefined();
    expect(result.paths['/api/auth/login'].post?.responses['401']).toBeUndefined();
  });

  it('adds 429 and 503 everywhere without overriding declared responses', () => {
    expect(result.paths['/api/auth/login'].post?.responses['429']).toBeDefined();
    expect(result.paths['/api/auth/login'].post?.responses['503']).toBeDefined();
    expect(result.paths['/api/health'].get?.responses['503']).toEqual({ description: 'custom' });
    expect(result.components?.schemas?.ErrorResponse).toBeDefined();
  });
});
