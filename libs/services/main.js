const fp = require('fastify-plugin');
const TLSSigAPIv2 = require('tls-sig-api-v2');
const tencentcloud = require('tencentcloud-sdk-nodejs-trtc');

const TrtcClient = tencentcloud.trtc.v20190722.Client;

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];
  const { Op } = fastify.sequelize.Sequelize;

  const getTrtcParams = props => {
    const params = Object.assign({}, props);
    if (typeof options.getParams === 'function') {
      return options.getParams(params);
    }
    return params;
  };

  const getUserSig = (userId, props) => {
    const { appId, appSecret, expire } = getTrtcParams(props);
    const api = new TLSSigAPIv2.Api(appId, appSecret);
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
    trtcClient = new TrtcClient(options.tencentcloud);
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
      RoomId: roomId,
      RoomIdType: 1
    });

    return await models.task.create({
      type,
      taskId: TaskId,
      startRequestId: RequestId,
      startTime: new Date(),
      instanceCaseId: instanceCase.id
    });
  };

  const stopTask = async ({ id, roomId, callback }) => {
    const instanceCase = await instanceCaseDetail({ roomId });
    const task = await models.task.findByPk(id);
    if (!task) {
      throw new Error('任务id不存在');
    }

    if (task.instanceCaseId !== instanceCase.id) {
      throw new Error('任务id和roomId不匹配');
    }
    if (task.stopTime) {
      return;
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
  };

  const startAITranscription = async ({ roomId, language, hotWordList, options }) => {
    return startTask({
      type: 'ai_transcription',
      roomId,
      options,
      callback: (client, args) => {
        return client.StartAITranscription(
          Object.assign({}, args, {
            TranscriptionParams: {
              UserId: args.UserId,
              UserSig: args.UserSig
            },
            RecognizeConfig: {
              Language: language || options?.language,
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
      callback: (client, args) => {
        return client.StopAITranscription(Object.assign({}, args));
      }
    });
  };

  const startRecord = async ({ roomId, options }) => {
    return startTask({
      type: 'record',
      roomId,
      options,
      callback: (client, args) => {
        return client.CreateCloudRecording(
          Object.assign({}, args, {
            StorageParams: {
              CloudStorage: {
                Region: options.cos.region,
                Bucket: options.cos.bucket,
                AccessKey: options.cos.accessKeyId,
                SecretKey: options.cos.accessKeySecret,
                Vendor: 0
              }
            },
            RecordParams: {
              RecordMode: 1,
              MaxIdleTime: 30,
              StreamType: 0,
              OutputFormat: 3
            }
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
        return client.DeleteCloudRecording({}, args);
      }
    });
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
      instanceCase.update({
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
      joinTime: instanceCase.userList[userId]?.joinTime
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

    const taskList = await models.task.findAll({ roomId });
    await Promise.allSettled(
      taskList
        .filter(({ stopTime }) => !!stopTime)
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
    removeMember
  });
});
