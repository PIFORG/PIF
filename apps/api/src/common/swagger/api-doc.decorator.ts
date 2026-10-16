import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/** Places an operation in one Swagger section with a short summary. */
export function ApiDoc(tag: string, summary: string, description?: string) {
  return applyDecorators(ApiTags(tag), ApiOperation({ summary, description }));
}
