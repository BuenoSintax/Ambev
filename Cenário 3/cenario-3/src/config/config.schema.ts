import JoiBase, { ObjectSchema, Root } from 'joi';

const Joi: Root = JoiBase;

export const configValidationSchema: ObjectSchema<Record<string, unknown>> =
  Joi.object({
    NODE_ENV: Joi.string()
      .valid('development', 'production', 'test')
      .default('development'),
    PORT: Joi.number().default(3000),
    MONGODB_URI: Joi.string().uri().required(),
    REQUEST_TIMEOUT_MS: Joi.number().default(10000),
    SEED_MAX_PER_SOURCE: Joi.number().default(200),
    SEED_API_KEY: Joi.string().default('dev-key-change-me'),
  });
