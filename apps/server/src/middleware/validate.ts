import { NextFunction, Request, Response } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ValidationError } from '../utils/errors';

type Schemas = Partial<{ body: AnyZodObject; query: AnyZodObject; params: AnyZodObject }>;

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query) as any;
      if (schemas.params) req.params = schemas.params.parse(req.params) as any;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new ValidationError(err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
        return;
      }
      next(err);
    }
  };
}
