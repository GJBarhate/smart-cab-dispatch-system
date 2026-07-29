"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.validate = validate;
var _zod = require("zod");
var _errors = require("../utils/errors");
function validate(schemas) {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      next();
    } catch (err) {
      if (err instanceof _zod.ZodError) {
        next(new _errors.ValidationError(err.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message
        }))));
        return;
      }
      next(err);
    }
  };
}
