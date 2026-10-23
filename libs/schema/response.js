// 响应 schema 会参与 fast-json-stringify 序列化：对象一律 additionalProperties: true 以免裁掉未声明字段；
// 用 nullable 而非类型数组（类型数组遇到不匹配的值会直接 500），类型不确定的字段（如 id、日期、JSON 列）只写说明不声明类型
const str = description => ({ type: 'string', nullable: true, description });
const num = description => ({ type: 'number', nullable: true, description });
const bool = description => ({ type: 'boolean', nullable: true, description });
const any = description => ({ description });
const list = (description, items) => ({ type: 'array', nullable: true, description, items });
const obj = (description, properties = {}) => ({ type: 'object', nullable: true, description, additionalProperties: true, properties });

const timestamps = () => ({
  createdAt: any('创建时间'),
  updatedAt: any('更新时间')
});

const success = (description, schema) => ({
  200: Object.assign({}, schema || { type: 'object' }, { description })
});

const pageResult = (description, item) => ({
  type: 'object',
  additionalProperties: true,
  properties: {
    pageData: list(`当前页${description}列表`, item),
    totalCount: num('符合条件的总条数')
  }
});

const instanceEvent = obj(
  'TRTC 房间事件',
  Object.assign(
    {
      id: any('事件 ID'),
      code: str('事件编码：TRTC 回调为 EventType 数字字符串（如 101 创建房间、103 进入房间），客户端上报为 Client.xxx'),
      time: any('事件发生时间'),
      payload: any('事件详情（回调 EventInfo 或客户端上报内容）'),
      trtcInstanceCaseId: any('所属 TRTC 实例（房间）ID')
    },
    timestamps()
  )
);

const task = obj(
  'TRTC 任务',
  Object.assign(
    {
      id: any('任务记录 ID'),
      type: str('任务类型：record 云端录制，ai_transcription AI 转写'),
      startRequestId: str('开始任务的 TRTC 请求 ID'),
      stopRequestId: str('结束任务的 TRTC 请求 ID，未结束为 null'),
      taskId: str('TRTC 任务 ID'),
      result: any('任务完成结果（录制文件、转写轮次等）'),
      startTime: any('开始时间'),
      stopTime: any('结束时间，进行中为 null'),
      options: any('扩展字段'),
      trtcInstanceCaseId: any('所属 TRTC 实例（房间）ID')
    },
    timestamps()
  )
);

module.exports = { str, num, bool, any, list, obj, success, pageResult, instanceEvent, task };
