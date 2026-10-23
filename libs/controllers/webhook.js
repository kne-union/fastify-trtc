const fp = require('fastify-plugin');
const { num, str, obj, success } = require('../schema/response');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.post(
    `${options.prefix}/callback`,
    {
      config: {
        rawBody: true
      },
      schema: {
        tags: ['TRTC-事件回调'],
        summary: 'TRTC事件回调',
        description:
          '接收 TRTC 服务端事件回调（房间事件、媒体事件等）并记录到房间事件、更新房间与任务状态。配置 callbackKey 时用 HMAC-SHA256 校验 sign 请求头，失败返回 403 { code: 1 }；事件处理出错默认仍返回 { code: 0 }，开启 failOnWebhookDispatchError 时返回 500 { code: 1 }',
        headers: {
          type: 'object',
          properties: {
            sign: { description: 'TRTC 回调签名：base64(HMAC-SHA256(callbackKey, 原始请求体))，未配置 callbackKey 时不校验' }
          }
        },
        body: {
          type: 'object',
          required: ['EventGroupId', 'EventType', 'CallbackTs', 'EventInfo'],
          properties: {
            EventGroupId: { type: 'number', description: '事件组 ID：1 房间事件，2 媒体事件，3 云端录制事件，8 页面录制事件' },
            EventType: { type: 'number', description: '事件类型，如 101 创建房间、102 解散房间、103 进入房间、104 退出房间、310 MP4 录制任务结束' },
            CallbackTs: { type: 'number', description: '回调发出时间，毫秒时间戳' },
            EventInfo: { type: 'object', description: '事件详情，含 RoomId、EventMsTs、UserId 等' }
          }
        },
        response: success(
          '已接收回调',
          obj('回调结果', {
            code: num('0 表示成功'),
            message: str('失败时的提示信息')
          })
        )
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
