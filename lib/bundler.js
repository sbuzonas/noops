'use strict';

const Lambundaler = require('lambundaler');
const Fse = require('fs-extra');


module.exports.bundle = function bundle (options, callback) {
  const handler = options.entry;
  const tmpFile = `${handler}.tmp`;

  // TODO: Quick hack using files. Should probably be in a browserify transform.
  Fse.copySync(handler, tmpFile);
  Fse.appendFileSync(handler,
                     `\n; module.exports.__main = ${__main.toString()}`);

  Lambundaler(options, function bundlerCb (err, buffer, artifacts) {
    Fse.copySync(tmpFile, handler);
    Fse.removeSync(tmpFile);
    callback(err, buffer, artifacts);
  });
};


function __main (event, context, callback) {
  const Boom = require('boom');
  const Insync = require('insync');
  const Joi = require('joi');

  Insync.waterfall([
    function init (next) {
      const request = {
        event,
        context,
        app: {},
        headers: event.params.header,
        method: event.context['http-method'],
        params: event.params.path,
        path: event.context['resource-path'],
        payload: JSON.parse(event['body-json']),
        query: event.params.querystring
      };

      // TODO: Implement reply interface
      const reply = {};

      next(null, request, reply);
    },
    function validate (request, reply, next) {
      const validation = module.exports.validate;

      if (!validation) {
        return next(null, request, reply);
      }

      function validateSource (source, callback) {
        const schema = validation[source];

        if (!schema) {
          return callback();
        }

        const localOptions = {
          context: {
            headers: request.headers,
            params: request.params,
            query: request.query,
            payload: request.payload,
            auth: request.auth
          }
        };

        delete localOptions.context[source];

        Joi.validate(request[source], schema, localOptions, (err, value) => {
          if (value !== undefined) {
            request[source] = value;
          }

          if (!err) {
            return callback();
          }

          // TODO: process error
          const error = err.isBoom ? err : Boom.badRequest(err.message, err);
          callback(error);
        });
      }

      Insync.series({
        params (next) { validateSource('params', next); },
        query (next) { validateSource('query', next); },
        payload (next) { validateSource('payload', next); },
        headers (next) { validateSource('headers', next); }
      }, (err) => {
        next(err, request, reply);
      });
    },
    function handler (request, reply, next) {
      module.exports.handler(request, next);
    }
  ], function lifecycleCb (err, response) {
    if (err) {
      const error = JSON.stringify(err.isBoom ? err :
                                                Boom.wrap(err, 500, err.message));
      return callback(error);
    }

    callback(null, response);
  });
}
