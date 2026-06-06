const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(`${options.prefix}/task/list`, {
    onRequest: options.getAuthenticate('task'),
    schema: {
      summary: '任务列表',
      query: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            default: {},
            properties: {
              instanceCaseId: { type: 'string' },
              roomId: { type: 'string' },
              type: { type: 'string', enum: ['record', 'ai_transcription'] },
              taskId: { type: 'string' },
              active: { type: 'boolean' },
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
    return services.task.list(request.tenantUserInfo, request.query);
  });

  fastify.get(`${options.prefix}/task/detail`, {
    onRequest: options.getAuthenticate('task'),
    schema: {
      summary: '任务详情',
      query: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' }
        }
      }
    }
  }, async (request) => {
    return services.task.detail(request.tenantUserInfo, request.query);
  });
});
