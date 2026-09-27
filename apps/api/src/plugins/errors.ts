import type { ApiError } from '@souqna/contracts';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.extra.retryAfterSeconds) {
        reply.header('retry-after', String(error.extra.retryAfterSeconds));
      }
      const body: ApiError = { error: error.code, ...error.extra };
      return reply.status(error.statusCode).send(body);
    }

    if (error instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of error.issues) {
        const path = issue.path.join('.') || '_';
        fields[path] ??=
          issue.code === 'invalid_type' && issue.input === undefined ? 'required' : issue.message;
      }
      return reply.status(400).send({ error: 'validation_failed', fields } satisfies ApiError);
    }

    const fastifyError = error as { statusCode?: number; code?: string };
    if (fastifyError.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: 'upload_too_large' } satisfies ApiError);
    }
    if (
      fastifyError.statusCode &&
      fastifyError.statusCode >= 400 &&
      fastifyError.statusCode < 500
    ) {
      return reply
        .status(fastifyError.statusCode)
        .send({ error: 'validation_failed' } satisfies ApiError);
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ error: 'internal_error' } satisfies ApiError);
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({ error: 'not_found' } satisfies ApiError);
  });
}
