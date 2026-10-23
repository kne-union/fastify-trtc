const fp = require('fastify-plugin');
const { success, pageResult, task } = require('../schema/response');

const TAG = 'TRTC-任务';

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/task/list`,
    {
      onRequest: options.getAuthenticate('task'),
      schema: {
        tags: [TAG],
        summary: '任务列表',
        description: '分页查询 TRTC 云端录制 / AI 转写任务，按创建时间倒序；按 roomId 过滤且房间不存在时返回空列表',
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
                type: { type: 'string', enum: ['record', 'ai_transcription'], description: '任务类型：record 云端录制，ai_transcription AI 转写' },
                taskId: { type: 'string', description: 'TRTC 任务 ID' },
                active: { type: 'boolean', description: 'true 只查进行中（未结束）的任务，false 只查已结束的任务' },
                startTime: { type: 'string', description: '任务开始时间下限（可被 Date 解析的时间）' },
                endTime: { type: 'string', description: '任务开始时间上限（可被 Date 解析的时间）' }
              }
            },
            perPage: { type: 'number', default: 20, description: '每页数量' },
            currentPage: { type: 'number', default: 1, description: '当前页' }
          }
        },
        response: success('任务分页列表', pageResult('任务', task))
      }
    },
    async request => {
      return services.task.list(request.tenantUserInfo, request.query);
    }
  );

  fastify.get(
    `${options.prefix}/task/detail`,
    {
      onRequest: options.getAuthenticate('task'),
      schema: {
        tags: [TAG],
        summary: '任务详情',
        description: '按 ID 获取 TRTC 任务，不存在时返回 404',
        query: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: '任务记录 ID' }
          }
        },
        response: success('任务详情', task)
      }
    },
    async request => {
      return services.task.detail(request.tenantUserInfo, request.query);
    }
  );
});
