import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { ApiDoc } from '../common/swagger/api-doc.decorator';
import { API_TAGS } from '../common/swagger/api-tags';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @ApiDoc(API_TAGS.health, 'Check service health')
  @Get()
  @ApiOkResponse({ description: 'API and database are reachable', schema: { example: { status: 'ok', database: 'up' } } })
  @ApiServiceUnavailableResponse({
    description: 'API is running but the database is unreachable',
    schema: { example: { status: 'degraded', database: 'down' } },
  })
  async check(@Res({ passthrough: true }) res: Response) {
    const up = await this.prisma.isReachable();
    res.status(up ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: up ? 'ok' : 'degraded', database: up ? 'up' : 'down' };
  }
}
