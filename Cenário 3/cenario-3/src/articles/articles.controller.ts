import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { ParseObjectIdOrStringPipe } from '../common/pipes/parse-objectid.pipe';
import { ArticlesService } from './articles.service';

@ApiTags('articles')
@Controller('api/v1/articles')
export class ArticlesController {
  constructor(private readonly svc: ArticlesService) {}

  @Get('latest')
  @ApiQuery({ name: 'page', required: false, schema: { default: 1 } })
  @ApiQuery({ name: 'pageSize', required: false, schema: { default: 20 } })
  @ApiQuery({ name: 'sourceId', required: false })
  @ApiQuery({ name: 'language', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date' })
  listLatest(
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
    @Query('sourceId') sourceId?: string,
    @Query('language') language?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.listLatest({
      page: Number(page),
      pageSize: Math.min(Number(pageSize), 100),
      sourceId,
      language,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get('search')
  @ApiQuery({ name: 'q', required: true })
  search(
    @Query('q') q: string,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
    @Query('sourceId') sourceId?: string,
    @Query('language') language?: string,
  ) {
    return this.svc.search({
      q,
      page: Number(page),
      pageSize: Math.min(Number(pageSize), 50),
      sourceId,
      language,
    });
  }

  @Get(':id')
  details(@Param('id', new ParseObjectIdOrStringPipe()) id: string) {
    return this.svc.getById(id);
  }
}
