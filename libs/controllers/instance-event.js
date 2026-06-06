const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(`${options.prefix}/instance-event/list`, {
    onRequest: options.getAuthenticate('instanceEvent'),
    schema: {
      summary: '事件列表',
      query: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            default: {},
            properties: {
              instanceCaseId: { type: 'string' },
              roomId: { type: 'string' },
              code: { type: 'string' },
              startTime: { type: 'string' },
              endTime: { type: 'string' }
            }
          },
          perPage: { type: 'number', default: 20 },
          currentPage: { type: 'number', default: 1 }
        }
      }
    }
  }, async (request) => {
    return services.instanceEvent.list(request.tenantUserInfo, request.query);
  });

  fastify.get(`${options.prefix}/instance-event/detail`, {
    onRequest: options.getAuthenticate('instanceEvent'),
    schema: {
      summary: '事件详情',
      query: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' }
        }
      }
    }
  }, async (request) => {
    return services.instanceEvent.detail(request.tenantUserInfo, request.query);
  });
});
