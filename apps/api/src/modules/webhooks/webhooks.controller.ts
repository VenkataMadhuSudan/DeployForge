import { Controller, Post, Headers, Req, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('github')
  @HttpCode(HttpStatus.OK)
  async handleGitHubWebhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: Request,
    @Body() body: any
  ) {
    // In NestJS with rawBody: true, req['rawBody'] contains the exact unaltered Buffer
    const rawBody = (req as any).rawBody || JSON.stringify(body);
    return this.webhooksService.handleGitHubWebhook(headers, rawBody, body);
  }
}
