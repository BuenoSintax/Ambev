import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SourcesService } from './sources.service';

@ApiTags('sources')
@Controller('/api/v1/sources')
export class SourcesController {
  constructor(private readonly svc: SourcesService) {}

  @Get()
  async list() {
    return this.svc.listActive();
  }
}
