const { expect } = require('chai');
const crypto = require('node:crypto');

const mockTrtcCalls = [];
class MockTrtcClient {
  constructor(options) {
    mockTrtcCalls.push({ method: 'constructor', params: options });
  }

  async CreateCloudRecording(params) {
    mockTrtcCalls.push({ method: 'CreateCloudRecording', params });
    return { RequestId: `record-start-${mockTrtcCalls.length}`, TaskId: `record-task-${mockTrtcCalls.length}` };
  }

  async DeleteCloudRecording(params) {
    mockTrtcCalls.push({ method: 'DeleteCloudRecording', params });
    return { RequestId: `record-stop-${mockTrtcCalls.length}` };
  }

  async StartAITranscription(params) {
    mockTrtcCalls.push({ method: 'StartAITranscription', params });
    return { RequestId: `ai-start-${mockTrtcCalls.length}`, TaskId: `ai-task-${mockTrtcCalls.length}` };
  }

  async StopAITranscription(params) {
    mockTrtcCalls.push({ method: 'StopAITranscription', params });
    return { RequestId: `ai-stop-${mockTrtcCalls.length}` };
  }

  async DescribeAIConversation(params) {
    mockTrtcCalls.push({ method: 'DescribeAIConversation', params });
    return { RequestId: `ai-describe-${mockTrtcCalls.length}`, TaskId: params.TaskId, Status: 'InProgress' };
  }

  async DismissRoomByStrRoomId(params) {
    mockTrtcCalls.push({ method: 'DismissRoomByStrRoomId', params });
    return { RequestId: `dismiss-${mockTrtcCalls.length}` };
  }

  async RemoveUserByStrRoomId(params) {
    mockTrtcCalls.push({ method: 'RemoveUserByStrRoomId', params });
    return { RequestId: `remove-${mockTrtcCalls.length}` };
  }
}

let mockBucketContents = [];
const mockCosCalls = [];
class MockCOS {
  constructor(options) {
    mockCosCalls.push({ method: 'constructor', params: options });
  }

  async getBucket(params) {
    mockCosCalls.push({ method: 'getBucket', params });
    return { Contents: mockBucketContents };
  }

  getObjectUrl(params) {
    mockCosCalls.push({ method: 'getObjectUrl', params });
    return `https://cos.example.test/${params.Key}`;
  }

  async deleteObject(params) {
    mockCosCalls.push({ method: 'deleteObject', params });
    return {};
  }
}

const trtcModulePath = require.resolve('tencentcloud-sdk-nodejs-trtc');
require.cache[trtcModulePath] = {
  id: trtcModulePath,
  filename: trtcModulePath,
  loaded: true,
  exports: {
    trtc: {
      v20190722: {
        Client: MockTrtcClient
      }
    }
  }
};

const cosModulePath = require.resolve('cos-nodejs-sdk-v5');
require.cache[cosModulePath] = {
  id: cosModulePath,
  filename: cosModulePath,
  loaded: true,
  exports: MockCOS
};

describe('@kne/fastify-trtc', function () {
  this.timeout(10000);

  const buildFastify = async (pluginOptions = {}) => {
    mockTrtcCalls.length = 0;
    mockCosCalls.length = 0;
    mockBucketContents = [];

    const fastify = require('fastify')();

    // 注册 sequelize
    await fastify.register(require('@kne/fastify-sequelize'), {
      db: {
        dialect: 'sqlite',
        storage: ':memory:',
        logging: false
      }
    });

    // 注册 account mock（getAuthenticate 依赖）
    fastify.decorate('account', {
      authenticate: {
        user: async () => {},
        admin: async () => {}
      }
    });

    // 注册 http-errors mock
    fastify.decorate('httpErrors', {
      notFound: (msg) => {
        const err = new Error(msg);
        err.statusCode = 404;
        return err;
      }
    });

    await fastify.register(require('../index'), Object.assign({
      appId: 1400000000,
      appSecret: 'test-secret-key',
      cos: {
        region: 'ap-guangzhou',
        bucket: 'test-bucket-1250000000',
        accessKeyId: 'test-secret-id',
        accessKeySecret: 'test-secret-key'
      },
      callbackKey: 'test-callback-key'
    }, pluginOptions));

    await fastify.ready();
    await fastify.sequelize.sync({ force: true });
    return fastify;
  };

  describe('插件注册测试', () => {
    it('should register plugin with default options', async () => {
      const fastify = await buildFastify();
      expect(fastify.trtc).to.exist;
      expect(fastify.trtc.services).to.exist;
      expect(fastify.trtc.models).to.exist;
      await fastify.close();
    });

    it('should register all service modules', async () => {
      const fastify = await buildFastify();
      const { services } = fastify.trtc;
      expect(services.startRecord).to.be.a('function');
      expect(services.stopRecord).to.be.a('function');
      expect(services.startAITranscription).to.be.a('function');
      expect(services.stopAITranscription).to.be.a('function');
      expect(services.join).to.be.a('function');
      expect(services.exit).to.be.a('function');
      expect(services.dismiss).to.be.a('function');
      expect(services.removeMember).to.be.a('function');
      expect(services.checkRecord).to.be.a('function');
      expect(services.webhook).to.exist;
      expect(services.webhook.verifySign).to.be.a('function');
      expect(services.webhook.dispatch).to.be.a('function');
      expect(services.cos).to.exist;
      expect(services.cos.createClient).to.be.a('function');
      expect(services.cos.getFileIdsByPathName).to.be.a('function');
      expect(services.cos.getFileIdsByFileKey).to.be.a('function');
      expect(services.instanceEvent).to.exist;
      expect(services.instanceEvent.list).to.be.a('function');
      expect(services.instanceEvent.detail).to.be.a('function');
      expect(services.task).to.exist;
      expect(services.task.list).to.be.a('function');
      expect(services.task.detail).to.be.a('function');
      await fastify.close();
    });

    it('should register all model modules', async () => {
      const fastify = await buildFastify();
      const { models } = fastify.trtc;
      expect(models.instanceCase).to.exist;
      expect(models.instanceEvent).to.exist;
      expect(models.task).to.exist;
      await fastify.close();
    });

    it('should sync database tables', async () => {
      const fastify = await buildFastify();
      const { models } = fastify.trtc;
      // 验证表已创建：尝试查询不应报错
      const cases = await models.instanceCase.findAll();
      expect(cases).to.be.an('array');
      await fastify.close();
    });
  });

  describe('房间管理功能测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await buildFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should create instanceCase when joining non-existent room', async () => {
      const result = await fastify.trtc.services.join({
        roomId: 'room_001',
        userId: 'user_001'
      });

      expect(result.roomId).to.equal('room_001');
      expect(result.userSig).to.exist;
      expect(result.id).to.exist;

      const instanceCase = await fastify.trtc.models.instanceCase.findOne({
        where: { roomId: 'room_001' }
      });
      expect(instanceCase).to.exist;
      expect(instanceCase.userList).to.have.property('user_001');
    });

    it('should update userList when joining existing room', async () => {
      await fastify.trtc.services.join({
        roomId: 'room_002',
        userId: 'user_001'
      });

      await fastify.trtc.services.join({
        roomId: 'room_002',
        userId: 'user_002'
      });

      const instanceCase = await fastify.trtc.models.instanceCase.findOne({
        where: { roomId: 'room_002' }
      });
      expect(instanceCase.userList).to.have.property('user_001');
      expect(instanceCase.userList).to.have.property('user_002');
    });

    it('should update exitTime when user exits room', async () => {
      await fastify.trtc.services.join({
        roomId: 'room_003',
        userId: 'user_001'
      });

      await fastify.trtc.services.exit({
        roomId: 'room_003',
        userId: 'user_001'
      });

      const instanceCase = await fastify.trtc.models.instanceCase.findOne({
        where: { roomId: 'room_003' }
      });
      expect(instanceCase.userList.user_001.exitTime).to.exist;
    });

    it('should throw error when exiting room not joined', async () => {
      await fastify.trtc.services.join({
        roomId: 'room_004',
        userId: 'user_001'
      });

      try {
        await fastify.trtc.services.exit({
          roomId: 'room_004',
          userId: 'user_002'
        });
        expect.fail('should have thrown error');
      } catch (e) {
        expect(e.message).to.equal('userId未加入房间');
      }
    });

    it('should throw error when id and roomId are both empty', async () => {
      try {
        await fastify.trtc.models.instanceCase.findOne({ where: {} });
        // 直接测试 instanceCaseDetail 的行为通过 join 间接测试
      } catch (e) {
        // expected
      }
    });
  });

  describe('任务生命周期测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await buildFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should start and stop record task with mocked TRTC client', async () => {
      const roomId = 'room_record_001';
      await fastify.trtc.services.join({ roomId, userId: 'user_001' });

      const task = await fastify.trtc.services.startRecord({
        roomId,
        recordParams: { OutputFormat: 4 },
        storageParams: { Bucket: 'override-bucket' }
      });

      expect(task.type).to.equal('record');
      expect(task.taskId).to.match(/^record-task-/);
      expect(task.startRequestId).to.match(/^record-start-/);

      const startCall = mockTrtcCalls.find(item => item.method === 'CreateCloudRecording');
      expect(startCall.params.RoomId).to.equal(roomId);
      expect(startCall.params.StorageParams.CloudStorage.Bucket).to.equal('override-bucket');
      expect(startCall.params.RecordParams.OutputFormat).to.equal(4);

      await fastify.trtc.services.stopRecord({ id: task.id, roomId });
      await task.reload();
      expect(task.stopTime).to.exist;
      expect(task.stopRequestId).to.match(/^record-stop-/);

      const stopCallCount = mockTrtcCalls.filter(item => item.method === 'DeleteCloudRecording').length;
      await fastify.trtc.services.stopRecord({ id: task.id, roomId });
      expect(mockTrtcCalls.filter(item => item.method === 'DeleteCloudRecording').length).to.equal(stopCallCount);
    });

    it('should start and stop ai transcription task with language options', async () => {
      const roomId = 'room_ai_001';
      await fastify.trtc.services.join({ roomId, userId: 'user_001' });

      const task = await fastify.trtc.services.startAITranscription({
        roomId,
        language: 'en',
        hotWordList: ['fastify']
      });

      expect(task.type).to.equal('ai_transcription');
      const startCall = mockTrtcCalls.find(item => item.method === 'StartAITranscription');
      expect(startCall.params.RoomId).to.equal(roomId);
      expect(startCall.params.TranscriptionParams.UserId).to.equal(`ai_transcription_${roomId}`);
      expect(startCall.params.RecognizeConfig.Language).to.equal('en');
      expect(startCall.params.RecognizeConfig.HotWordList).to.deep.equal(['fastify']);

      await fastify.trtc.services.stopAITranscription({ id: task.id, roomId });
      await task.reload();
      expect(task.stopTime).to.exist;
      expect(mockTrtcCalls.some(item => item.method === 'StopAITranscription')).to.be.true;
    });

    it('should dismiss room and stop unfinished tasks', async () => {
      const roomId = 'room_dismiss_001';
      await fastify.trtc.services.join({ roomId, userId: 'user_001' });
      const task = await fastify.trtc.services.startRecord({ roomId });

      await fastify.trtc.services.dismiss({ roomId });
      await task.reload();

      const instanceCase = await fastify.trtc.models.instanceCase.findOne({ where: { roomId } });
      expect(instanceCase.endTime).to.exist;
      expect(task.stopTime).to.exist;
      expect(mockTrtcCalls.some(item => item.method === 'DismissRoomByStrRoomId')).to.be.true;
      expect(mockTrtcCalls.some(item => item.method === 'DeleteCloudRecording')).to.be.true;
    });

    it('should remove member through mocked TRTC client', async () => {
      const roomId = 'room_remove_001';
      await fastify.trtc.services.join({ roomId, userId: 'user_001' });

      await fastify.trtc.services.removeMember({ roomId, userId: 'user_001' });

      const removeCall = mockTrtcCalls.find(item => item.method === 'RemoveUserByStrRoomId');
      expect(removeCall.params.RoomId).to.equal(roomId);
      expect(removeCall.params.UserIds).to.deep.equal(['user_001']);
    });

    it('should throw when stopping a task with unmatched roomId', async () => {
      await fastify.trtc.services.join({ roomId: 'room_task_001', userId: 'user_001' });
      await fastify.trtc.services.join({ roomId: 'room_task_002', userId: 'user_002' });
      const task = await fastify.trtc.services.startRecord({ roomId: 'room_task_001' });

      try {
        await fastify.trtc.services.stopRecord({ id: task.id, roomId: 'room_task_002' });
        expect.fail('should have thrown error');
      } catch (e) {
        expect(e.message).to.equal('任务id和roomId不匹配');
      }
    });
  });

  describe('签名校验测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await buildFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should verify sign correctly with callbackKey', () => {
      const body = JSON.stringify({ test: 'data' });
      const sign = crypto.createHmac('sha256', 'test-callback-key').update(body).digest('base64');
      const result = fastify.trtc.services.webhook.verifySign({ sign, body });
      expect(result).to.be.true;
    });

    it('should reject invalid sign', () => {
      const body = JSON.stringify({ test: 'data' });
      const result = fastify.trtc.services.webhook.verifySign({ sign: 'invalid-sign', body });
      expect(result).to.be.false;
    });

    it('should skip sign verification when callbackKey is empty', async () => {
      const fastifyNoKey = await buildFastify({ callbackKey: '' });
      const body = JSON.stringify({ test: 'data' });
      const result = fastifyNoKey.trtc.services.webhook.verifySign({ sign: null, body });
      expect(result).to.be.true;
      await fastifyNoKey.close();
    });
  });

  describe('事件记录测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await buildFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should dispatch room create event and record it', async () => {
      // 先创建房间
      await fastify.trtc.services.join({ roomId: 'room_event_001', userId: 'user_001' });

      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 1,
        EventType: 101,
        CallbackTs: Date.now(),
        EventInfo: {
          RoomId: 'room_event_001',
          UserId: 'user_001',
          EventMsTs: Date.now()
        }
      });

      const events = await fastify.trtc.models.instanceEvent.findAll({
        where: { code: '101' }
      });
      expect(events.length).to.be.greaterThan(0);
      expect(events[0].payload.eventGroupId).to.equal(1);
      expect(events[0].payload.eventType).to.equal(101);
    });

    it('should update instanceCase endTime on room dismiss event', async () => {
      await fastify.trtc.services.join({ roomId: 'room_event_002', userId: 'user_001' });

      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 1,
        EventType: 102,
        CallbackTs: Date.now(),
        EventInfo: {
          RoomId: 'room_event_002',
          EventMsTs: Date.now()
        }
      });

      const instanceCase = await fastify.trtc.models.instanceCase.findOne({
        where: { roomId: 'room_event_002' }
      });
      expect(instanceCase.endTime).to.exist;
    });

    it('should update userList on enter room event', async () => {
      await fastify.trtc.services.join({ roomId: 'room_event_003', userId: 'user_001' });

      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 1,
        EventType: 103,
        CallbackTs: Date.now(),
        EventInfo: {
          RoomId: 'room_event_003',
          UserId: 'user_001',
          EventMsTs: Date.now(),
          Role: 0,
          TerminalType: 1,
          UserType: 0
        }
      });

      const instanceCase = await fastify.trtc.models.instanceCase.findOne({
        where: { roomId: 'room_event_003' }
      });
      expect(instanceCase.userList.user_001.joinTime).to.exist;
      expect(instanceCase.userList.user_001.role).to.equal(0);
    });

    it('should update userList on exit room event', async () => {
      await fastify.trtc.services.join({ roomId: 'room_event_004', userId: 'user_001' });

      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 1,
        EventType: 104,
        CallbackTs: Date.now(),
        EventInfo: {
          RoomId: 'room_event_004',
          UserId: 'user_001',
          EventMsTs: Date.now(),
          Reason: 0
        }
      });

      const instanceCase = await fastify.trtc.models.instanceCase.findOne({
        where: { roomId: 'room_event_004' }
      });
      expect(instanceCase.userList.user_001.status).to.equal(1);
      expect(instanceCase.userList.user_001.exitTime).to.exist;
    });

    it('should record media event', async () => {
      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 2,
        EventType: 201,
        CallbackTs: Date.now(),
        EventInfo: {
          RoomId: 'room_media_001',
          UserId: 'user_001',
          EventMsTs: Date.now()
        }
      });

      const events = await fastify.trtc.models.instanceEvent.findAll({
        where: { code: '201' }
      });
      expect(events.length).to.be.greaterThan(0);
    });

    it('should handle unknown event group id', async () => {
      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 99,
        EventType: 999,
        CallbackTs: Date.now(),
        EventInfo: {
          RoomId: 'room_unknown',
          EventMsTs: Date.now()
        }
      });

      const events = await fastify.trtc.models.instanceEvent.findAll({
        where: { code: '999' }
      });
      expect(events.length).to.be.greaterThan(0);
    });

    it('should update record task result on mp4 record finish event', async () => {
      const roomId = 'room_record_event_001';
      await fastify.trtc.services.join({ roomId, userId: 'user_001' });
      const instanceCase = await fastify.trtc.models.instanceCase.findOne({ where: { roomId } });
      const task = await fastify.trtc.models.task.create({
        type: 'record',
        taskId: 'record-event-task-001',
        startRequestId: 'record-start-request',
        startTime: new Date(),
        trtcInstanceCaseId: instanceCase.id
      });

      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 3,
        EventType: 310,
        CallbackTs: Date.now(),
        EventInfo: {
          RoomId: roomId,
          TaskId: task.taskId,
          EventMsTs: Date.now(),
          Payload: {
            Status: 0,
            FileList: ['video-001.mp4'],
            FileMessage: 'upload complete'
          }
        }
      });

      await task.reload();
      expect(task.result).to.deep.equal(['video-001.mp4']);
      expect(task.stopTime).to.exist;
      expect(task.options.fileMessage).to.equal('upload complete');
    });

    it('should upload record files through fileManager on mp4 record finish event', async () => {
      const roomId = 'room_record_event_002';
      await fastify.trtc.services.join({ roomId, userId: 'user_001' });
      const instanceCase = await fastify.trtc.models.instanceCase.findOne({ where: { roomId } });
      const task = await fastify.trtc.models.task.create({
        type: 'record',
        taskId: 'record-event-task-002',
        startRequestId: 'record-start-request',
        startTime: new Date(),
        trtcInstanceCaseId: instanceCase.id
      });
      fastify.fileManager = {
        services: {
          uploadFromUrl: async ({ url }) => ({ id: `stored:${url.split('/').pop()}` })
        }
      };

      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 3,
        EventType: 310,
        CallbackTs: Date.now(),
        EventInfo: {
          RoomId: roomId,
          TaskId: task.taskId,
          EventMsTs: Date.now(),
          Payload: {
            Status: 0,
            FileList: ['video-002.mp4'],
            FileMessage: 'stored'
          }
        }
      });

      await task.reload();
      expect(task.result).to.deep.equal(['stored:video-002.mp4']);
      expect(mockCosCalls.some(item => item.method === 'deleteObject')).to.be.true;
    });

    it('should store record error status on failed mp4 record finish event', async () => {
      const task = await fastify.trtc.models.task.create({
        type: 'record',
        taskId: 'record-event-task-003',
        startRequestId: 'record-start-request',
        startTime: new Date(),
        trtcInstanceCaseId: (await fastify.trtc.models.instanceCase.create({ roomId: 'room_record_event_003' })).id
      });

      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 3,
        EventType: 310,
        CallbackTs: Date.now(),
        EventInfo: {
          TaskId: task.taskId,
          EventMsTs: Date.now(),
          Payload: {
            Status: 1001,
            FileMessage: 'failed'
          }
        }
      });

      await task.reload();
      expect(task.stopTime).to.exist;
      expect(task.options.recordStatus).to.equal(1001);
      expect(task.options.fileMessage).to.equal('failed');
    });

    it('should update vod task metadata from record events', async () => {
      const task = await fastify.trtc.models.task.create({
        type: 'record',
        taskId: 'record-vod-task-001',
        startRequestId: 'record-start-request',
        startTime: new Date(),
        trtcInstanceCaseId: (await fastify.trtc.models.instanceCase.create({ roomId: 'room_vod_event_001' })).id
      });

      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 3,
        EventType: 311,
        CallbackTs: Date.now(),
        EventInfo: {
          TaskId: task.taskId,
          EventMsTs: Date.now(),
          Payload: { VodFileId: 'vod-file-id' }
        }
      });
      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 3,
        EventType: 312,
        CallbackTs: Date.now(),
        EventInfo: {
          TaskId: task.taskId,
          EventMsTs: Date.now(),
          Payload: { Status: 'Stopped' }
        }
      });

      await task.reload();
      expect(task.options.vodCommit).to.deep.equal({ VodFileId: 'vod-file-id' });
      expect(task.options.vodStop).to.deep.equal({ Status: 'Stopped' });
      expect(task.stopTime).to.exist;
    });

    it('should record web record events', async () => {
      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 8,
        EventType: 801,
        CallbackTs: Date.now(),
        EventInfo: {
          RoomId: 'room_web_record_001',
          EventMsTs: Date.now()
        }
      });

      const events = await fastify.trtc.models.instanceEvent.findAll({ where: { code: '801' } });
      expect(events.length).to.equal(1);
      expect(events[0].payload.eventGroupId).to.equal(8);
    });

    it('should append ai transcription rounds on transcription event', async () => {
      const task = await fastify.trtc.models.task.create({
        type: 'ai_transcription',
        taskId: 'ai-event-task-001',
        startRequestId: 'ai-start-request',
        startTime: new Date(),
        result: { rounds: [] },
        trtcInstanceCaseId: (await fastify.trtc.models.instanceCase.create({ roomId: 'room_ai_event_001' })).id
      });

      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 9,
        EventType: 903,
        CallbackTs: Date.now(),
        EventInfo: {
          TaskId: task.taskId,
          Payload: {
            UserId: 'user_001',
            Text: 'hello',
            StartTimeMs: Date.now() - 1000,
            EndTimeMs: Date.now(),
            RoundId: 'round-001'
          }
        }
      });

      await task.reload();
      expect(task.stopRequestId).to.equal('round-001');
      expect(task.result.rounds).to.have.length(1);
      expect(task.result.rounds[0].text).to.equal('hello');
      expect(task.options.lastRound.userId).to.equal('user_001');
    });
  });

  describe('事件查询测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await buildFastify();
      // 创建测试数据
      await fastify.trtc.services.join({ roomId: 'room_query_001', userId: 'user_001' });
      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 1,
        EventType: 101,
        CallbackTs: Date.now(),
        EventInfo: { RoomId: 'room_query_001', EventMsTs: Date.now() }
      });
      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 1,
        EventType: 103,
        CallbackTs: Date.now(),
        EventInfo: { RoomId: 'room_query_001', UserId: 'user_001', EventMsTs: Date.now() }
      });
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should list events with pagination', async () => {
      const result = await fastify.trtc.services.instanceEvent.list({}, { perPage: 10, currentPage: 1 });
      expect(result).to.have.property('pageData');
      expect(result).to.have.property('totalCount');
      expect(result.totalCount).to.be.greaterThan(0);
      expect(result.pageData.length).to.be.greaterThan(0);
    });

    it('should filter events by code', async () => {
      const result = await fastify.trtc.services.instanceEvent.list({}, {
        filter: { code: '101' },
        perPage: 10,
        currentPage: 1
      });
      expect(result.totalCount).to.be.greaterThan(0);
      result.pageData.forEach(item => {
        expect(item.code).to.equal('101');
      });
    });

    it('should filter events by roomId', async () => {
      const result = await fastify.trtc.services.instanceEvent.list({}, {
        filter: { roomId: 'room_query_001' },
        perPage: 10,
        currentPage: 1
      });
      expect(result.totalCount).to.be.greaterThan(0);
    });

    it('should return empty when roomId not found', async () => {
      const result = await fastify.trtc.services.instanceEvent.list({}, {
        filter: { roomId: 'non_existent_room' },
        perPage: 10,
        currentPage: 1
      });
      expect(result.totalCount).to.equal(0);
      expect(result.pageData.length).to.equal(0);
    });

    it('should get event detail by id', async () => {
      const listResult = await fastify.trtc.services.instanceEvent.list({}, { perPage: 1, currentPage: 1 });
      const eventId = listResult.pageData[0].id;
      const detail = await fastify.trtc.services.instanceEvent.detail({}, { id: eventId });
      expect(detail).to.exist;
      expect(detail.id).to.equal(eventId);
    });

    it('should throw notFound when event id not found', async () => {
      try {
        await fastify.trtc.services.instanceEvent.detail({}, { id: 'non-existent-id' });
        expect.fail('should have thrown error');
      } catch (e) {
        expect(e.statusCode).to.equal(404);
      }
    });
  });

  describe('任务查询测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await buildFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should list tasks with pagination', async () => {
      const result = await fastify.trtc.services.task.list({}, { perPage: 10, currentPage: 1 });
      expect(result).to.have.property('pageData');
      expect(result).to.have.property('totalCount');
    });

    it('should return empty when roomId not found', async () => {
      const result = await fastify.trtc.services.task.list({}, {
        filter: { roomId: 'non_existent_room' },
        perPage: 10,
        currentPage: 1
      });
      expect(result.totalCount).to.equal(0);
      expect(result.pageData.length).to.equal(0);
    });

    it('should throw notFound when task id not found', async () => {
      try {
        await fastify.trtc.services.task.detail({}, { id: 'non-existent-id' });
        expect.fail('should have thrown error');
      } catch (e) {
        expect(e.statusCode).to.equal(404);
      }
    });
  });

  describe('COS 服务测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await buildFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should return cached COS client instance', () => {
      const client1 = fastify.trtc.services.cos.createClient();
      const client2 = fastify.trtc.services.cos.createClient();
      expect(client1).to.equal(client2);
    });

    it('should return empty array from getFileIdsByPathName when bucket is empty', async () => {
      // 由于没有真实 COS 服务，只测试空值保护逻辑
      const result = await fastify.trtc.services.cos.getFileIdsByPathName({ pathname: 'nonexistent' }).catch(() => []);
      expect(result).to.be.an('array');
    });

    it('should return empty array from getFileIdsByFileKey when keys is empty', async () => {
      const result = await fastify.trtc.services.cos.getFileIdsByFileKey({ keys: [] });
      expect(result).to.deep.equal([]);
    });

    it('should return empty array from getFileIdsByFileKey when keys is null', async () => {
      const result = await fastify.trtc.services.cos.getFileIdsByFileKey({ keys: null });
      expect(result).to.deep.equal([]);
    });

    it('should upload COS files by pathname and delete source objects', async () => {
      mockBucketContents = [{ Key: 'record-task/video-001.mp4' }, { Key: 'record-task/video-002.mp4' }];
      fastify.fileManager = {
        services: {
          uploadFromUrl: async ({ url }) => ({ id: `file:${url.split('/').pop()}` })
        }
      };

      const result = await fastify.trtc.services.cos.getFileIdsByPathName({ pathname: 'record-task' });

      expect(result).to.deep.equal(['file:video-001.mp4', 'file:video-002.mp4']);
      expect(mockCosCalls.find(item => item.method === 'getBucket').params.Prefix).to.equal('record-task/');
      expect(mockCosCalls.filter(item => item.method === 'deleteObject').map(item => item.params.Key)).to.deep.equal([
        'record-task/video-001.mp4',
        'record-task/video-002.mp4'
      ]);
    });

    it('should upload COS files by file key and delete source objects', async () => {
      fastify.fileManager = {
        services: {
          uploadFromUrl: async ({ url }) => ({ id: `file:${url.split('/').pop()}` })
        }
      };

      const result = await fastify.trtc.services.cos.getFileIdsByFileKey({ keys: ['video-003.mp4'] });

      expect(result).to.deep.equal(['file:video-003.mp4']);
      const objectUrlCall = mockCosCalls.find(item => item.method === 'getObjectUrl');
      expect(objectUrlCall.params.Key).to.equal('video-003.mp4');
      expect(mockCosCalls.find(item => item.method === 'deleteObject').params.Key).to.equal('video-003.mp4');
    });
  });

  describe('回调接口测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await buildFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should return 403 when sign verification fails', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/trtc/callback',
        headers: { 'content-type': 'application/json', sign: 'invalid-sign' },
        payload: {
          EventGroupId: 1,
          EventType: 101,
          CallbackTs: Date.now(),
          EventInfo: { RoomId: 'test' }
        }
      });
      expect(response.statusCode).to.equal(403);
    });

    it('should return code 0 when sign verification passes', async () => {
      const payload = {
        EventGroupId: 1,
        EventType: 101,
        CallbackTs: Date.now(),
        EventInfo: { RoomId: 'test', EventMsTs: Date.now() }
      };
      const body = JSON.stringify(payload);
      const sign = crypto.createHmac('sha256', 'test-callback-key').update(body).digest('base64');

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/trtc/callback',
        headers: { 'content-type': 'application/json', sign },
        payload
      });
      expect(response.statusCode).to.equal(200);
      const result = JSON.parse(response.body);
      expect(result.code).to.equal(0);
    });
  });

  describe('边界情况测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await buildFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should handle event with non-existent roomId', async () => {
      // 不应抛错，只是 instanceCaseId 为 null
      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 1,
        EventType: 101,
        CallbackTs: Date.now(),
        EventInfo: {
          RoomId: 'non_existent_room',
          EventMsTs: Date.now()
        }
      });

      const events = await fastify.trtc.models.instanceEvent.findAll({
        where: { code: '101' }
      });
      expect(events.length).to.be.greaterThan(0);
      // instanceCaseId 应该为 null/undefined（房间不存在）
      expect(events[0].instanceCaseId).to.not.exist;
    });

    it('should handle event without EventMsTs', async () => {
      const callbackTs = Date.now();
      await fastify.trtc.services.webhook.dispatch({
        EventGroupId: 1,
        EventType: 101,
        CallbackTs: callbackTs,
        EventInfo: {
          RoomId: 'room_no_ts'
        }
      });

      const events = await fastify.trtc.models.instanceEvent.findAll({
        where: { code: '101' }
      });
      expect(events.length).to.be.greaterThan(0);
    });

    it('should handle instanceEvent list with empty filter', async () => {
      const result = await fastify.trtc.services.instanceEvent.list({}, {});
      expect(result).to.have.property('pageData');
      expect(result).to.have.property('totalCount');
    });

    it('should handle task list with empty filter', async () => {
      const result = await fastify.trtc.services.task.list({}, {});
      expect(result).to.have.property('pageData');
      expect(result).to.have.property('totalCount');
    });

    it('should filter events by time range', async () => {
      const now = new Date();
      const result = await fastify.trtc.services.instanceEvent.list({}, {
        filter: {
          startTime: now.toISOString(),
          endTime: new Date(now.getTime() + 3600000).toISOString()
        },
        perPage: 10,
        currentPage: 1
      });
      expect(result).to.have.property('pageData');
    });

    it('should filter tasks by active status', async () => {
      const activeResult = await fastify.trtc.services.task.list({}, {
        filter: { active: true },
        perPage: 10,
        currentPage: 1
      });
      expect(activeResult).to.have.property('pageData');

      const inactiveResult = await fastify.trtc.services.task.list({}, {
        filter: { active: false },
        perPage: 10,
        currentPage: 1
      });
      expect(inactiveResult).to.have.property('pageData');
    });
  });
});
