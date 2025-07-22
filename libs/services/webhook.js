const fp = require('fastify-plugin');
const COS = require('cos-nodejs-sdk-v5');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];
  const { Op } = fastify.sequelize.Sequelize;

  const createClient = () => {
    return new COS({
      SecretId: options.cos.accessKeyId,
      SecretKey: options.cos.accessKeySecret,
      Region: options.cos.region
    });
  };

  const aiTranscription = async ({ input }) => {
    if (input.EventType !== 903) {
      return;
    }
    const { TaskId, Payload } = input.EventInfo;
    const { UserId, Text, StartTimeMs, EndTimeMs, RoundId } = Payload;
    const task = await models.task.findOne({
      where: {
        taskId: TaskId
      }
    });
    if (!task) {
      throw new Error('任务不存在');
    }
    await task.update({
      stopRequestId: RoundId,
      result: {
        userId: UserId,
        text: Text,
        startTime: new Date(StartTimeMs),
        endTime: new Date(EndTimeMs)
      },
      stopTime: new Date()
    });
  };

  const record = async ({ input }) => {
    if (input.EventType !== 310) {
      return;
    }
    const { TaskId, Payload } = input.EventInfo;
    const { FileList, Status } = Payload;
    if (Status !== 0) {
      return;
    }
    const task = await models.task.findOne({
      where: {
        taskId: TaskId
      }
    });
    if (!task) {
      throw new Error('任务不存在');
    }

    if (!fastify.fileManager) {
      await task.update({
        result: FileList,
        stopTime: new Date()
      });
      return;
    }

    const cosClient = createClient();

    const fileList = await Promise.all(
      FileList.map(async file => {
        const url = cosClient.getObjectUrl({
          Bucket: options.cos.bucket,
          Region: options.cos.region,
          Key: file,
          Sign: true
        });
        const fileInfo = await fastify.fileManager.services.uploadFromUrl({ url });

        await cosClient.deleteObject({
          Bucket: options.cos.bucket,
          Region: options.cos.region,
          Key: file
        });

        return fileInfo;
      })
    );

    await task.update({
      result: fileList,
      stopTime: new Date()
    });
    return fileList;
  };

  const trtc = async ({ input }) => {
    await models.instanceEvent.create({
      code: input.EventType,
      time: new Date(input.CallbackTs),
      payload: input.EventInfo
    });
  };

  Object.assign(fastify[options.name].services, {
    webhook: {
      aiTranscription,
      record,
      trtc
    }
  });
});
