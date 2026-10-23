const fp = require('fastify-plugin');
const { success, pageResult, instanceEvent } = require('../schema/response');

const TAG = 'TRTC-房间事件';

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/instance-event/list`,
    {
      onRequest: options.getAuthenticate('instanceEvent'),
      schema: {
        tags: [TAG],
        summary: '事件列表',
        description: '分页查询 TRTC 房间事件，按创建时间倒序；按 roomId 过滤且房间不存在时返回空列表',
        query: {
          type: 'object',
          properties: {
            filter: {
              type: 'object',
              default: {},
              description: '过滤条件',
              properties: {
                instanceCaseId: { type: 'string', description: 'TRTC 实例（房间记录）ID' },
                roomId: { type: 'string', description: '房间号，优先于 instanceCaseId' },
                code: { type: 'string', description: '事件编码' },
                startTime: { type: 'string', description: '事件时间下限（可被 Date 解析的时间）' },
                endTime: { type: 'string', description: '事件时间上限（可被 Date 解析的时间）' }
              }
            },
            perPage: { type: 'number', default: 20, description: '每页数量' },
            currentPage: { type: 'number', default: 1, description: '当前页' }
          }
        },
        response: success('事件分页列表', pageResult('事件', instanceEvent))
      }
    },
    async request => {
      return services.instanceEvent.list(request.tenantUserInfo, request.query);
    }
  );

  fastify.get(
    `${options.prefix}/instance-event/detail`,
    {
      onRequest: options.getAuthenticate('instanceEvent'),
      schema: {
        tags: [TAG],
        summary: '事件详情',
        description: '按 ID 获取 TRTC 房间事件，不存在时返回 404',
        query: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: '事件 ID' }
          }
        },
        response: success('事件详情', instanceEvent)
      }
    },
    async request => {
      return services.instanceEvent.detail(request.tenantUserInfo, request.query);
    }
  );
});
