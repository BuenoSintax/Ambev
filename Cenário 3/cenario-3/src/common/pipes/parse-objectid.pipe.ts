import { PipeTransform, BadRequestException, Injectable } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';

@Injectable()
export class ParseObjectIdOrStringPipe
  implements PipeTransform<string, string>
{
  transform(value: string) {
    if (/^[a-fA-F0-9]{24}$/.test(value) && isValidObjectId(value)) return value;
    if (value && value.length >= 8) return value; // articleId (hash)
    throw new BadRequestException('Invalid id');
  }
}
