const fp = require('fastify-plugin');
const crypto = require('node:crypto');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];

  // 签名校验
  const verifySign = ({ sign, body }) => {
    if (!options.callbackKey) {
      return true;
    }
    const computedSign = crypto.createHmac('sha256', options.callbackKey).update(body).digest('base64');
    if (!sign) {
      return false;
    }
    const computedSignBuffer = Buffer.from(computedSign);
    const signBuffer = Buffer.from(sign);
    return computedSignBuffer.length === signBuffer.length && crypto.timingSafeEqual(computedSignBuffer, signBuffer);
  };

  // 根据 roomId 查找 instanceCase 并记录事件
  const recordEvent = async ({ EventGroupId, EventType, CallbackTs, EventInfo }) => {
    const eventInfo = {
      eventGroupId: EventGroupId,
      eventType: EventType,
      roomId: EventInfo.RoomId,
      userId: EventInfo.UserId,
      taskId: EventInfo.TaskId,
      eventMsTs: EventInfo.EventMsTs,
      payload: EventInfo.Payload
    };

    let instanceCaseId = null;
    if (EventInfo.RoomId) {
      const instanceCase = await models.instanceCase.findOne({
        where: { roomId: String(EventInfo.RoomId) }
      });
      if (instanceCase) {
        instanceCaseId = instanceCase.id;
      }
    }

    await models.instanceEvent.create({
      code: String(EventType),
      time: new Date(EventInfo.EventMsTs || CallbackTs),
      payload: eventInfo,
      trtcInstanceCaseId: instanceCaseId
    });

    return instanceCaseId;
  };

  // ============ 房间事件 (EventGroupId=1) ============

  const handleRoomEvent = async input => {
    const { EventType, EventInfo } = input;
    switch (EventType) {
      case 101: // 创建房间
        await recordEvent({ EventGroupId: 1, EventType, CallbackTs: input.CallbackTs, EventInfo });
        break;
      case 102: // 解散房间
        await recordEvent({ EventGroupId: 1, EventType, CallbackTs: input.CallbackTs, EventInfo });
        {
          const instanceCase = await models.instanceCase.findOne({
            where: { roomId: String(EventInfo.RoomId) }
          });
          if (instanceCase && !instanceCase.endTime) {
            await instanceCase.update({ endTime: new Date(EventInfo.EventMsTs) });
          }
        }
        break;
      case 103: // 进入房间
        await recordEvent({ EventGroupId: 1, EventType, CallbackTs: input.CallbackTs, EventInfo });
        {
          const instanceCase = await models.instanceCase.findOne({
            where: { roomId: String(EventInfo.RoomId) }
          });
          if (instanceCase) {
            const userList = Object.assign({}, instanceCase.userList);
            if (userList[EventInfo.UserId]) {
              userList[EventInfo.UserId] = Object.assign({}, userList[EventInfo.UserId], {
                status: 0,
                joinTime: new Date(EventInfo.EventMsTs),
                role: EventInfo.Role,
                terminalType: EventInfo.TerminalType,
                userType: EventInfo.UserType
              });
            }
            if (!instanceCase.startTime) {
              await instanceCase.update({
                startTime: new Date(EventInfo.EventMsTs),
                userList
              });
            } else {
              await instanceCase.update({ userList });
            }
          }
        }
        break;
      case 104: // 退出房间
        await recordEvent({ EventGroupId: 1, EventType, CallbackTs: input.CallbackTs, EventInfo });
        {
          const instanceCase = await models.instanceCase.findOne({
            where: { roomId: String(EventInfo.RoomId) }
          });
          if (instanceCase) {
            const userList = Object.assign({}, instanceCase.userList);
            if (userList[EventInfo.UserId]) {
              userList[EventInfo.UserId] = Object.assign({}, userList[EventInfo.UserId], {
                status: 1,
                exitTime: new Date(EventInfo.EventMsTs),
                reason: EventInfo.Reason
              });
            }
            await instanceCase.update({ userList });
          }
        }
        break;
      case 105: // 切换角色
        await recordEvent({ EventGroupId: 1, EventType, CallbackTs: input.CallbackTs, EventInfo });
        break;
      default:
        await recordEvent({ EventGroupId: 1, EventType, CallbackTs: input.CallbackTs, EventInfo });
    }
  };

  // ============ 媒体事件 (EventGroupId=2) ============

  const handleMediaEvent = async input => {
    await recordEvent({ EventGroupId: 2, EventType: input.EventType, CallbackTs: input.CallbackTs, EventInfo: input.EventInfo });
  };

  // ============ 云端录制事件 (EventGroupId=3) ============

  const handleRecordEvent = async input => {
    const { EventType, EventInfo } = input;
    const { TaskId, Payload } = EventInfo;

    switch (EventType) {
      case 301: // 录制模块启动
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
        break;
      case 302: // 录制模块退出
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
        break;
      case 303: // 上传任务启动
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
        break;
      case 304: // 生成 m3u8 索引文件
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
        break;
      case 305: // 上传结束
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
        break;
      case 306: // 录制迁移
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
        break;
      case 307: // 生成 m3u8 切片
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
        break;
      case 309: // 下载解码图片错误
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
        break;
      case 310: // MP4 录制任务结束
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
        {
          const task = await models.task.findOne({ where: { taskId: TaskId } });
          if (!task) {
            break;
          }
          if (Payload.Status !== 0) {
            await task.update({
              stopTime: new Date(),
              options: Object.assign({}, task.options, {
                recordStatus: Payload.Status,
                fileMessage: Payload.FileMessage
              })
            });
            break;
          }
          if (!fastify.fileManager) {
            await task.update({
              result: Payload.FileList,
              stopTime: new Date(),
              options: Object.assign({}, task.options, {
                fileMessage: Payload.FileMessage
              })
            });
            break;
          }
          const fileList = await services.cos.getFileIdsByFileKey({ keys: Payload.FileList });
          await task.update({
            result: fileList,
            stopTime: new Date(),
            options: Object.assign({}, task.options, {
              fileMessage: Payload.FileMessage
            })
          });
        }
        break;
      case 311: // VOD 录制上传完成
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
        {
          const task = await models.task.findOne({ where: { taskId: TaskId } });
          if (task) {
            await task.update({
              options: Object.assign({}, task.options, {
                vodCommit: Payload
              })
            });
          }
        }
        break;
      case 312: // VOD 录制任务结束
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
        {
          const task = await models.task.findOne({ where: { taskId: TaskId } });
          if (task && !task.stopTime) {
            await task.update({
              stopTime: new Date(),
              options: Object.assign({}, task.options, {
                vodStop: Payload
              })
            });
          }
        }
        break;
      default:
        await recordEvent({ EventGroupId: 3, EventType, CallbackTs: input.CallbackTs, EventInfo });
    }
  };

  // ============ 页面录制事件 (EventGroupId=8) ============

  const handleWebRecordEvent = async input => {
    await recordEvent({ EventGroupId: 8, EventType: input.EventType, CallbackTs: input.CallbackTs, EventInfo: input.EventInfo });
  };

  // ============ AI 转写事件 (EventType=903) ============

  const handleAITranscriptionEvent = async input => {
    if (input.EventType !== 903) {
      return;
    }
    const { TaskId, Payload } = input.EventInfo;
    const { UserId, Text, StartTimeMs, EndTimeMs, RoundId } = Payload;
    const task = await models.task.findOne({
      where: { taskId: TaskId }
    });
    if (!task) {
      return;
    }

    const currentResult = task.result || { rounds: [] };
    const rounds = [
      ...currentResult.rounds,
      {
        userId: UserId,
        text: Text,
        startTime: new Date(StartTimeMs),
        endTime: new Date(EndTimeMs),
        roundId: RoundId
      }
    ];

    await task.update({
      stopRequestId: RoundId,
      result: Object.assign({}, currentResult, { rounds }),
      options: Object.assign({}, task.options, {
        lastRound: {
          userId: UserId,
          text: Text,
          startTime: new Date(StartTimeMs),
          endTime: new Date(EndTimeMs),
          roundId: RoundId
        }
      })
    });
  };

  // ============ 事件分发 ============

  const dispatch = async input => {
    const { EventGroupId } = input;
    switch (EventGroupId) {
      case 1: // 房间事件
        await handleRoomEvent(input);
        break;
      case 2: // 媒体事件
        await handleMediaEvent(input);
        break;
      case 3: // 云端录制事件
        await handleRecordEvent(input);
        break;
      case 8: // 页面录制事件
        await handleWebRecordEvent(input);
        break;
      default:
        if (input.EventType === 903) {
          await handleAITranscriptionEvent(input);
        } else {
          await recordEvent({ EventGroupId, EventType: input.EventType, CallbackTs: input.CallbackTs, EventInfo: input.EventInfo });
        }
    }
  };

  Object.assign(fastify[options.name].services, {
    webhook: {
      verifySign,
      dispatch
    }
  });
});
