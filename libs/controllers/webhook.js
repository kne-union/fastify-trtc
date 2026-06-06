const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.post(
    `${options.prefix}/callback`,
    {
      config: {
        rawBody: true
      },
      schema: {
        summary: 'TRTC事件回调',
        body: {
          type: 'object',
          required: ['EventGroupId', 'EventType', 'CallbackTs', 'EventInfo'],
          properties: {
            EventGroupId: { type: 'number' },
            EventType: { type: 'number' },
            CallbackTs: { type: 'number' },
            EventInfo: { type: 'object' }
          }
        }
      }
    },
    async (request, reply) => {
      const sign = request.headers['sign'];
      const rawBody = request.rawBody || JSON.stringify(request.body);

      if (!services.webhook.verifySign({ sign, body: rawBody })) {
        reply.code(403);
        return { code: 1, message: '签名校验失败' };
      }

      try {
        await services.webhook.dispatch(request.body);
      } catch (e) {
        console.error('TRTC webhook dispatch error:', e);
        if (options.failOnWebhookDispatchError) {
          reply.code(500);
          return { code: 1, message: '事件处理失败' };
        }
      }

      return { code: 0 };
    }
  );
});
