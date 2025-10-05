import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  // Express é o padrão quando não passamos FastifyAdapter
  const app = await NestFactory.create(AppModule);
  console.log('MONGODB_URI=', process.env.MONGODB_URI);
  app.enableCors();
  //app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const config = new DocumentBuilder()
    .setTitle('Market Pulse API')
    .setDescription('Cenário 3 — artigos (latest / search / details)')
    .setVersion('1.0.0')
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/docs', app, doc);

  await app.listen(Number(process.env.PORT) || 3000, '0.0.0.0');
}
void bootstrap();
