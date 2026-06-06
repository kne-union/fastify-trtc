const fp = require('fastify-plugin');
const TLSSigAPIv2 = require('tls-sig-api-v2');
const tencentcloud = require('tencentcloud-sdk-nodejs-trtc');

const TrtcClient = tencentcloud.trtc.v20190722.Client;

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];

  const getTrtcParams = props => {
    const params = Object.assign({}, options, props);
    if (typeof options.getParams === 'function') {
      return options.getParams(params);
    }
    return params;
  };

  let tlsSigApi;
  const getTlsSigApi = () => {
    const { appId, appSecret } = getTrtcParams();
    if (!tlsSigApi || tlsSigApi.appId !== appId || tlsSigApi.appSecret !== appSecret) {
      tlsSigApi = { appId, appSecret, api: new TLSSigAPIv2.Api(appId, appSecret) };
    }
    return tlsSigApi.api;
  };

  const getUserSig = (userId, props) => {
    const { appId, appSecret, expire } = getTrtcParams(props);
    const api = getTlsSigApi();
    const userSig = api.genUserSig(userId, expire || 60 * 10);
    return {
      sdkAppId: appId,
      userId,
      userSig
    };
  };

  let trtcClient;

  const getTrtcClient = () => {
    if (trtcClient) {
      return trtcClient;
    }
    trtcClient = new TrtcClient(options);
    return trtcClient;
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
    const client = getTrtcClient();
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

  const stopTask = async ({ id, roomId, callback }) => {
    const task = await getTask({ id, roomId });
    if (task.stopTime) {
      return task;
    }
    const { appId } = getTrtcParams();
    const client = getTrtcClient();
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
    return startTask({
      type: 'ai_transcription',
      roomId,
      options,
      callback: async (client, { UserSig, UserId, ...args }) => {
        if (taskId) {
          try {
            const task = await getTask({ id: taskId, roomId });
            const res = await client.DescribeAIConversation({
              SdkAppId: args.sdkAppId,
              TaskId: task.taskId
            });
            if (res.Status === 'InProgress') {
              return res;
            }
          } catch (e) {
            console.error(e);
          }
        }

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

  const stopAITranscription = async ({ id, roomId }) => {
    return stopTask({
      id,
      roomId,
      callback: (client, { TaskId }) => {
        return client.StopAITranscription(Object.assign({}, { TaskId }));
      }
    });
  };

  const startRecord = async ({ roomId, options: targetOptions, recordParams, storageParams }) => {
    return startTask({
      type: 'record',
      roomId,
      options: targetOptions,
      callback: (client, args) => {
        return client.CreateCloudRecording(
          Object.assign({}, args, {
            RoomIdType: 0,
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

  const stopRecord = async ({ id, roomId }) => {
    return stopTask({
      id,
      roomId,
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
            startTime: new Date(),
            userSig,
            status: 0,
            options
          }
        },
        joinTime: new Date()
      });
    } else {
      await instanceCase.update({
        userList: Object.assign({}, instanceCase.userList, {
          [userId]: Object.assign({}, instanceCase.userList[userId], {
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
      startTime: instanceCase.userList[userId]?.startTime
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
    const client = getTrtcClient();
    // 调用TRTC服务端API结束会议
    const { appId } = getTrtcParams(options);
    await client.DismissRoomByStrRoomId({
      SdkAppId: appId,
      RoomId: instanceCase.roomId
    });

    await instanceCase.update({
      endTime: new Date()
    });

    const taskList = await models.task.findAll({
      where: { trtcInstanceCaseId: instanceCase.id }
    });
    await Promise.allSettled(
      taskList
        .filter(({ stopTime }) => !stopTime)
        .map(({ id, type }) => {
          if (type === 'record') {
            return stopRecord({ id, roomId });
          }
          if (type === 'ai_transcription') {
            return stopAITranscription({ id, roomId });
          }
        })
    );
  };

  const removeMember = async ({ userId, roomId, options }) => {
    const instanceCase = await instanceCaseDetail({ roomId });
    const client = getTrtcClient();
    const { appId } = getTrtcParams(options);
    await client.RemoveUserByStrRoomId({
      SdkAppId: appId,
      RoomId: instanceCase.roomId,
      UserIds: [userId]
    });
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
    checkRecord
  });
});
