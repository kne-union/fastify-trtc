const fp = require('fastify-plugin');
const TLSSigAPIv2 = require('tls-sig-api-v2');
const tencentcloud = require('tencentcloud-sdk-nodejs-trtc');

const TrtcClient = tencentcloud.trtc.v20190722.Client;

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];

  const omitUndefined = target => {
    return Object.fromEntries(Object.entries(target || {}).filter(([, value]) => value !== undefined));
  };

  const normalizeTrtcParams = params => {
    if (params.appId !== undefined && params.appId !== '') {
      params.appId = Number(params.appId);
    }
    const credential = Object.assign(
      {},
      omitUndefined(options.credential || options.tencentcloud?.credential),
      omitUndefined(params.credential || params.tencentcloud?.credential),
      omitUndefined(params.secretId || params.secretKey ? { secretId: params.secretId, secretKey: params.secretKey } : undefined)
    );
    if (Object.keys(credential).length > 0) {
      params.credential = credential;
    } else {
      delete params.credential;
    }
    return params;
  };

  const getTrtcParams = props => {
    const currentProps = omitUndefined(props);
    const params = normalizeTrtcParams(Object.assign({}, options, currentProps));
    if (typeof options.getParams === 'function') {
      return normalizeTrtcParams(Object.assign({}, params, omitUndefined(options.getParams(params))));
    }
    return params;
  };

  let tlsSigApi;
  const getTlsSigApi = props => {
    const { appId, appSecret } = getTrtcParams(props);
    if (!tlsSigApi || tlsSigApi.appId !== appId || tlsSigApi.appSecret !== appSecret) {
      tlsSigApi = { appId, appSecret, api: new TLSSigAPIv2.Api(appId, appSecret) };
    }
    return tlsSigApi.api;
  };

  const getUserSig = (userId, props) => {
    const { appId, appSecret, expire } = getTrtcParams(props);
    if (!Number.isFinite(appId) || !appSecret) {
      throw new Error('TRTC appId and appSecret are required');
    }
    const api = getTlsSigApi(props);
    const userSig = api.genUserSig(userId, expire || 60 * 10);
    return {
      sdkAppId: appId,
      userId,
      userSig
    };
  };

  const trtcClientMap = new Map();

  const getTrtcClient = props => {
    const params = getTrtcParams(props);
    if (!params.credential?.secretId || !params.credential?.secretKey) {
      throw new Error('TRTC credential.secretId and credential.secretKey are required');
    }
    const cacheKey = JSON.stringify({
      credential: params.credential,
      region: params.region,
      profile: params.profile
    });
    if (trtcClientMap.has(cacheKey)) {
      return trtcClientMap.get(cacheKey);
    }
    const trtcClient = new TrtcClient(params);
    trtcClientMap.set(cacheKey, trtcClient);
    return trtcClient;
  };

  const getEventTime = event => {
    return new Date(event.time || event.payload?.eventMsTs || event.payload?.time || event.payload?.event?.Time).getTime();
  };

  const getRoomInfo = async ({ instanceCase, client, appId }) => {
    const endTime = Math.floor(new Date(instanceCase.endTime || new Date()).getTime() / 1000);
    const startTime = Math.max(0, endTime - 24 * 60 * 60 + 1);
    const { RoomList = [] } = await client.DescribeRoomInfo({
      SdkAppId: appId,
      StartTime: startTime,
      EndTime: endTime,
      RoomId: String(instanceCase.roomId)
    });
    return RoomList.find(item => String(item.RoomString || item.RoomId || '') === String(instanceCase.roomId)) || RoomList[0];
  };

  const isDescribeRoomInfoTimeLimitError = error => {
    return ['InvalidParameter.StartTimeOversize', 'InvalidParameter.QueryScaleOversize'].includes(error?.code);
  };

  const eventRecordExists = (existingEvents, predicate) => {
    return existingEvents.some(event => predicate(event.payload || {}, event));
  };

  const createEventRecord = async ({ existingEvents, code, time, payload, trtcInstanceCaseId }) => {
    const record = await models.instanceEvent.create({
      code,
      time,
      payload,
      trtcInstanceCaseId
    });
    existingEvents.push(record);
    return record;
  };

  const syncCallDetailInfo = async ({ instanceCase, client, appId, commId, startTime, endTime, existingEvents }) => {
    const createdEvents = [];
    const users = new Map();
    const pageSize = 100;
    for (let currentStartTime = startTime; currentStartTime <= endTime; currentStartTime += 4 * 60 * 60) {
      const currentEndTime = Math.min(endTime, currentStartTime + 4 * 60 * 60 - 1);
      for (let pageNumber = 0; ; pageNumber += 1) {
        const { UserList = [] } = await client.DescribeCallDetailInfo({
          SdkAppId: appId,
          CommId: commId,
          StartTime: currentStartTime,
          EndTime: currentEndTime,
          PageNumber: pageNumber,
          PageSize: pageSize
        });
        for (const user of UserList || []) {
          const userId = user.UserId;
          if (!userId) {
            continue;
          }
          users.set(String(userId), user);
          if (eventRecordExists(existingEvents, payload => payload.source === 'DescribeCallDetailInfo' && payload.recordType === 'user' && String(payload.userId) === String(userId) && payload.joinTs === user.JoinTs && payload.leaveTs === user.LeaveTs)) {
            continue;
          }
          const record = await createEventRecord({
            existingEvents,
            code: 'DescribeCallDetailInfo.User',
            time: new Date(((user.JoinTs || user.LeaveTs || currentStartTime) * 1000)),
            payload: {
              source: 'DescribeCallDetailInfo',
              recordType: 'user',
              roomId: instanceCase.roomId,
              commId,
              userId,
              joinTs: user.JoinTs,
              leaveTs: user.LeaveTs,
              user
            },
            trtcInstanceCaseId: instanceCase.id
          });
          createdEvents.push(record);
        }
        if (!UserList || UserList.length < pageSize) {
          break;
        }
      }
    }

    if (users.size > 0) {
      const userList = Object.assign({}, instanceCase.userList);
      users.forEach((user, userId) => {
        userList[userId] = Object.assign({}, userList[userId], {
          startTime: user.JoinTs ? new Date(user.JoinTs * 1000) : userList[userId]?.startTime,
          exitTime: user.LeaveTs ? new Date(user.LeaveTs * 1000) : userList[userId]?.exitTime,
          status: user.Finished ? 1 : userList[userId]?.status,
          metrics: user
        });
      });
      await instanceCase.update({ userList });
    }

    const userIds = Array.from(users.keys());
    const userGroups = userIds.length > 0 ? Array.from({ length: Math.ceil(userIds.length / 6) }, (_, index) => userIds.slice(index * 6, index * 6 + 6)) : [undefined];
    for (let currentStartTime = startTime; currentStartTime <= endTime; currentStartTime += 60 * 60) {
      const currentEndTime = Math.min(endTime, currentStartTime + 60 * 60 - 1);
      for (const userGroup of userGroups) {
        const { Data = [] } = await client.DescribeCallDetailInfo({
          SdkAppId: appId,
          CommId: commId,
          StartTime: currentStartTime,
          EndTime: currentEndTime,
          DataType: ['all'],
          PageNumber: 0,
          PageSize: userGroup ? userGroup.length : 6,
          ...(userGroup ? { UserIds: userGroup } : {})
        });
        for (const item of Data || []) {
          if (eventRecordExists(existingEvents, payload => payload.source === 'DescribeCallDetailInfo' && payload.recordType === 'metric' && String(payload.userId || '') === String(item.UserId || '') && String(payload.peerId || '') === String(item.PeerId || '') && payload.dataType === item.DataType && payload.startTime === currentStartTime && payload.endTime === currentEndTime)) {
            continue;
          }
          const record = await createEventRecord({
            existingEvents,
            code: 'DescribeCallDetailInfo.Metric',
            time: new Date(currentStartTime * 1000),
            payload: {
              source: 'DescribeCallDetailInfo',
              recordType: 'metric',
              roomId: instanceCase.roomId,
              commId,
              userId: item.UserId,
              peerId: item.PeerId,
              dataType: item.DataType,
              startTime: currentStartTime,
              endTime: currentEndTime,
              data: item
            },
            trtcInstanceCaseId: instanceCase.id
          });
          createdEvents.push(record);
        }
      }
    }
    return createdEvents;
  };

  const syncRoomUserEvents = async ({ instanceCase, options: targetOptions }) => {
    if (!(targetOptions?.enableRestApiQuery ?? options.enableRestApiQuery)) {
      return [];
    }
    if (!instanceCase.startTime) {
      return [];
    }
    const { appId } = getTrtcParams(targetOptions);
    const client = getTrtcClient(targetOptions);
    let roomInfo;
    try {
      roomInfo = await getRoomInfo({ instanceCase, client, appId });
    } catch (e) {
      if (isDescribeRoomInfoTimeLimitError(e)) {
        console.warn(`Skip syncing TRTC room user events because room info query time is out of range: ${instanceCase.roomId}`);
        return [];
      }
      throw e;
    }
    if (!roomInfo?.CommId) {
      return [];
    }
    const startTime = roomInfo.CreateTime || Math.floor(new Date(instanceCase.startTime).getTime() / 1000);
    const endTime = roomInfo.DestroyTime || Math.floor(new Date(instanceCase.endTime || new Date()).getTime() / 1000);
    const commId = roomInfo.CommId;
    if (roomInfo?.CreateTime && new Date(instanceCase.startTime).getTime() !== roomInfo.CreateTime * 1000) {
      await instanceCase.update({
        startTime: new Date(roomInfo.CreateTime * 1000)
      });
    }
    const existingEvents = await models.instanceEvent.findAll({
      where: {
        trtcInstanceCaseId: instanceCase.id
      }
    });
    const eventExists = ({ userId, time, eventId }) => {
      return eventRecordExists(existingEvents, (payload, event) => {
        return (
          String(payload.userId || payload.peerId || '') === String(userId) &&
          getEventTime(event) === Number(time) &&
          (String(event.code) === String(eventId) || payload.eventId === eventId || payload.eventType)
        );
      });
    };
    const createdEvents = [];
    const { Data = [] } = await client.DescribeUserEvent({
      SdkAppId: appId,
      CommId: commId,
      StartTime: startTime,
      EndTime: endTime
    });
    for (const item of Data) {
      const peerId = item.PeerId || item.UserId;
      for (const event of item.Content || []) {
        if (eventExists({ userId: peerId, time: event.Time, eventId: event.EventId })) {
          continue;
        }
        const record = await createEventRecord({
          existingEvents,
          code: String(event.EventId),
          time: new Date(event.Time),
          payload: {
            source: 'DescribeUserEvent',
            roomId: instanceCase.roomId,
            userId: peerId,
            peerId,
            commId,
            eventId: event.EventId,
            type: event.Type,
            paramOne: event.ParamOne,
            paramTwo: event.ParamTwo,
            event
          },
          trtcInstanceCaseId: instanceCase.id
        });
        createdEvents.push(record);
      }
    }
    createdEvents.push(...(await syncCallDetailInfo({ instanceCase, client, appId, commId, startTime, endTime, existingEvents })));
    return createdEvents;
  };

  const instanceCaseDetail = async ({ roomId, id }) => {
    if (id) {
      const instanceCase = await models.instanceCase.findByPk(id);
      if (!instanceCase) {
        throw new Error('房间不存在');
      }
      return instanceCase;
    }
    if (roomId) {
      const instanceCase = await models.instanceCase.findOne({
        where: {
          roomId
        }
      });

      if (!instanceCase) {
        throw new Error('房间不存在');
      }
      return instanceCase;
    }

    throw new Error('id和roomId不能同时为空');
  };

  const startTask = async ({ roomId, type, options, callback }) => {
    const instanceCase = await instanceCaseDetail({ roomId });
    const client = getTrtcClient(options);
    const userSig = getUserSig(`${type}_${roomId}`, options);
    const { RequestId, TaskId } = await callback(client, {
      UserId: userSig.userId,
      UserSig: userSig.userSig,
      SdkAppId: userSig.sdkAppId,
      RoomId: roomId
    });

    return await models.task.create({
      type,
      taskId: TaskId,
      startRequestId: RequestId,
      startTime: new Date(),
      trtcInstanceCaseId: instanceCase.id
    });
  };

  const getTask = async ({ id, roomId }) => {
    const instanceCase = await instanceCaseDetail({ roomId });
    const task = await models.task.findByPk(id);
    if (!task) {
      throw new Error('任务id不存在');
    }

    if (task.trtcInstanceCaseId !== instanceCase.id) {
      throw new Error('任务id和roomId不匹配');
    }
    return task;
  };

  const stopTask = async ({ id, roomId, options, callback }) => {
    const task = await getTask({ id, roomId });
    if (task.stopTime) {
      return task;
    }
    const { appId } = getTrtcParams(options);
    const client = getTrtcClient(options);
    const { RequestId } = await callback(client, {
      SdkAppId: appId,
      TaskId: task.taskId
    });

    await task.update({
      stopRequestId: RequestId,
      stopTime: new Date()
    });

    return task;
  };

  const startAITranscription = async ({ roomId, language, hotWordList, taskId, options }) => {
    if (taskId) {
      try {
        const task = await getTask({ id: taskId, roomId });
        const client = getTrtcClient(options);
        const { appId } = getTrtcParams(options);
        const res = await client.DescribeAIConversation({
          SdkAppId: appId,
          TaskId: task.taskId
        });
        if (res.Status === 'InProgress') {
          return task;
        }
      } catch (e) {
        console.error(e);
      }
    }
    return startTask({
      type: 'ai_transcription',
      roomId,
      options,
      callback: async (client, { UserSig, UserId, ...args }) => {
        return client.StartAITranscription(
          Object.assign({}, args, {
            RoomIdType: 1,
            TranscriptionParams: {
              UserId,
              UserSig
            },
            RecognizeConfig: {
              Language: language || options?.language || 'zh',
              HotWordList: hotWordList || options?.hotWordList
            }
          })
        );
      }
    });
  };

  const stopAITranscription = async ({ id, roomId, options }) => {
    return stopTask({
      id,
      roomId,
      options,
      callback: (client, args) => {
        return client.StopAITranscription(Object.assign({}, args));
      }
    });
  };

  const startRecord = async ({ roomId, options: targetOptions, recordParams, storageParams, roomIdType }) => {
    return startTask({
      type: 'record',
      roomId,
      options: targetOptions,
      callback: (client, args) => {
        return client.CreateCloudRecording(
          Object.assign({}, args, {
            RoomIdType: roomIdType ?? targetOptions?.roomIdType ?? options.roomIdType ?? 0,
            StorageParams: {
              CloudStorage: Object.assign({}, {
                Region: options.cos.region,
                Bucket: options.cos.bucket,
                AccessKey: options.cos.accessKeyId,
                SecretKey: options.cos.accessKeySecret,
                Vendor: 0
              }, storageParams)
            },
            RecordParams: Object.assign({}, {
              RecordMode: 1,
              MaxIdleTime: 30,
              StreamType: 0,
              OutputFormat: 3
            }, recordParams)
          })
        );
      }
    });
  };

  const stopRecord = async ({ id, roomId, options }) => {
    return stopTask({
      id,
      roomId,
      options,
      callback: (client, args) => {
        return client.DeleteCloudRecording(Object.assign({}, args));
      }
    });
  };

  const checkRecord = async ({ id, roomId }) => {
    const task = await getTask({ id, roomId });
    if (task.result) {
      return task;
    }
    const result = await services.cos.getFileIdsByPathName({ pathname: task.taskId });
    if (result && result.length > 0) {
      await task.update({
        result,
        stopTime: new Date()
      });
    }
    return task;
  };

  const join = async ({ roomId, userId, options }) => {
    const userSig = getUserSig(userId, options);
    const startTime = new Date();
    let instanceCase = await models.instanceCase.findOne({
      where: {
        roomId
      }
    });
    if (!instanceCase) {
      instanceCase = await models.instanceCase.create({
        roomId,
        userList: {
          [userId]: {
            startTime,
            userSig,
            status: 0,
            options
          }
        },
        startTime
      });
    } else {
      await instanceCase.update({
        userList: Object.assign({}, instanceCase.userList, {
          [userId]: Object.assign({}, instanceCase.userList[userId], {
            startTime,
            userSig,
            status: 0,
            options
          })
        })
      });
    }

    return {
      userSig,
      id: instanceCase.id,
      roomId,
      options,
      startTime
    };
  };

  const exit = async ({ roomId, userId }) => {
    const instanceCase = await instanceCaseDetail({ roomId });

    if (!instanceCase.userList[userId]) {
      throw new Error('userId未加入房间');
    }

    await instanceCase.update({
      userList: Object.assign({}, instanceCase.userList, {
        [userId]: Object.assign({}, instanceCase.userList[userId], {
          exitTime: new Date()
        })
      })
    });
  };

  const dismiss = async ({ roomId, options }) => {
    const instanceCase = await instanceCaseDetail({ roomId });
    const client = getTrtcClient(options);
    // 调用TRTC服务端API结束会议
    const { appId } = getTrtcParams(options);
    await client.DismissRoomByStrRoomId({
      SdkAppId: appId,
      RoomId: instanceCase.roomId
    });

    await instanceCase.update({
      endTime: new Date()
    });
    try {
      await syncRoomUserEvents({ instanceCase, options });
    } catch (e) {
      console.error('Failed to sync TRTC room user events:', e);
    }

    const taskList = await models.task.findAll({
      where: { trtcInstanceCaseId: instanceCase.id }
    });
    await Promise.allSettled(
      taskList
        .filter(({ stopTime }) => !stopTime)
        .map(({ id, type }) => {
          if (type === 'record') {
            return stopRecord({ id, roomId, options });
          }
          if (type === 'ai_transcription') {
            return stopAITranscription({ id, roomId, options });
          }
        })
    );
  };

  const removeMember = async ({ userId, roomId, options }) => {
    const instanceCase = await instanceCaseDetail({ roomId });
    const client = getTrtcClient(options);
    const { appId } = getTrtcParams(options);
    await client.RemoveUserByStrRoomId({
      SdkAppId: appId,
      RoomId: instanceCase.roomId,
      UserIds: [userId]
    });
  };

  const getRoomSnapshot = async ({ roomId }) => {
    const instanceCase = await models.instanceCase.findOne({
      where: { roomId: String(roomId) }
    });
    if (!instanceCase) {
      return {
        roomId: String(roomId),
        members: [],
        updatedAt: new Date().toISOString()
      };
    }
    const events = await models.instanceEvent.findAll({
      where: { trtcInstanceCaseId: instanceCase.id },
      order: [['time', 'DESC']],
      limit: 500
    });
    const latestEventsByUser = {};
    events.forEach(event => {
      const payload = event.payload || {};
      if (payload.source !== 'ClientSDK') {
        return;
      }
      const userId = String(payload.userId || payload.reporterId || '');
      if (!userId) {
        return;
      }
      const eventType = payload.eventType;
      if (!latestEventsByUser[userId]) {
        latestEventsByUser[userId] = {};
      }
      const time = new Date(event.time).getTime();
      if (!latestEventsByUser[userId][eventType] || time > latestEventsByUser[userId][eventType].time) {
        latestEventsByUser[userId][eventType] = {
          time,
          data: payload.event?.data || payload.event
        };
      }
    });
    const userList = instanceCase.userList || {};
    const members = Object.entries(userList).map(([userId, userState]) => {
      const userEvents = latestEventsByUser[String(userId)] || {};
      const getEventTime = type => userEvents[type]?.time || 0;
      return {
        userId: String(userId),
        status: userState.status,
        startTime: userState.startTime || null,
        exitTime: userState.exitTime || null,
        online: userState.status === 0,
        cameraOpen: getEventTime('camera-open') >= getEventTime('camera-close'),
        microphoneOpen: getEventTime('microphone-open') >= getEventTime('microphone-close'),
        networkQuality: userEvents['network-quality']?.data || null,
        statistics: userEvents.statistics?.data || null,
        deviceInfo: userEvents['device-info']?.data || null,
        lastEventAt: Object.values(userEvents).reduce((max, item) => Math.max(max, item.time || 0), 0) || null
      };
    });
    return {
      roomId: String(roomId),
      startTime: instanceCase.startTime,
      endTime: instanceCase.endTime,
      members,
      updatedAt: new Date().toISOString()
    };
  };

  Object.assign(fastify[options.name].services, {
    startAITranscription,
    stopAITranscription,
    startRecord,
    stopRecord,
    join,
    exit,
    dismiss,
    removeMember,
    checkRecord,
    syncRoomUserEvents,
    getRoomSnapshot
  });
});
