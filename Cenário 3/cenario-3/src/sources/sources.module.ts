import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Source, SourceSchema } from './schemas/source.schema';
import { SourcesService } from './sources.service';
import { SourcesController } from './sources.controller';
import { SourcesAdminController } from './sources.admin.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Source.name, schema: SourceSchema }]),
  ],
  providers: [SourcesService],
  controllers: [SourcesController, SourcesAdminController],
  exports: [MongooseModule, SourcesService],
})
export class SourcesModule {}
