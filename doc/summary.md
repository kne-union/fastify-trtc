### 项目概述

`@kne/fastify-trtc` 是一个 Fastify 插件，封装腾讯云实时音视频（TRTC）服务端 API，提供房间管理、云端录制、AI 转写、事件回调等完整能力。插件通过 `@kne/fastify-namespace` 组织模块，集成 `@kne/fastify-sequelize` 做数据持久化，自动记录房间实例、任务和事件。

### 核心架构与流程

```
客户端/TRTC回调
       │
       ↓
  Controllers (路由层)
       │
       ↓
  Services (业务层)
   ┌───┼───────────┬──────────────┐
   │   │           │              │
  main  cos    webhook    instance-event  task
   │   │           │              │        │
   ↓   ↓           ↓              ↓        ↓
 TRTC  COS     事件分发        事件查询   任务查询
 SDK   SDK     +持久化
                    │
                    ↓
               Models (数据层)
          ┌─────┼─────────┐
     instanceCase  task  instanceEvent
```

| 层级 | 职责 |
|------|------|
| Controllers | 处理 HTTP 请求、参数校验、认证、调用 Service |
| Services | 核心业务逻辑：TRTC API 调用、事件处理、数据查询 |
| Models | Sequelize 数据模型定义与关联关系 |

### 核心概念详解

#### 房间生命周期

```
join(加入) → [startRecord/startAITranscription](启动任务) → [stopRecord/stopAITranscription](停止任务)
       ↓                                                          ↓
  创建 instanceCase                                       更新 task.stopTime
       ↓
  dismiss(解散) / exit(退出)
       ↓
  更新 instanceCase.endTime + 停止所有未完成任务
```

- **join**：用户加入房间，若房间不存在则自动创建 `instanceCase`
- **exit**：用户主动退出，更新 `userList` 中对应用户的 `exitTime`
- **dismiss**：解散房间，调用 TRTC API 踢出所有用户，并自动停止所有未完成的录制/转写任务
- **removeMember**：将指定用户从房间移除

#### 事件回调机制

TRTC 服务端在房间事件、媒体事件、录制事件等发生时，向配置的回调地址推送事件。插件接收后：

1. **签名校验**：使用 `callbackKey` 进行 HMAC-SHA256 验证
2. **事件分发**：按 `EventGroupId` 路由到对应处理器
3. **持久化**：所有事件记录到 `instanceEvent` 表，部分事件触发业务逻辑更新

| EventGroupId | 事件组 | 处理逻辑 |
|-------------|--------|---------|
| 1 | 房间事件 | 记录事件 + 更新 instanceCase 状态 |
| 2 | 媒体事件 | 记录事件 |
| 3 | 云端录制事件 | 记录事件 + 更新 task 结果/状态 |
| 8 | 页面录制事件 | 记录事件 |
| - | AI 转写 (EventType=903) | 累积转写轮次到 task.result |

> **关键设计**：录制结束事件（310）会自动将 COS 文件通过 `fileManager` 转存并删除原文件，若 `fileManager` 不可用则直接存储原始文件列表。

#### COS 文件转存

录制完成后，MP4 文件存储在腾讯云 COS。插件提供两种转存方式：

- `getFileIdsByPathName`：按路径前缀批量获取并转存
- `getFileIdsByFileKey`：按文件 Key 精确获取并转存

转存后自动从 COS 删除原文件，避免存储冗余。

### 主要特性

- **UserSig 生成**：内置签名缓存，避免重复创建 `TLSSigAPIv2.Api` 实例
- **TRTC Client 单例**：`TrtcClient` 和 `COS Client` 均为单例缓存
- **录制参数可配置**：`startRecord` 支持通过 `recordParams`/`storageParams` 覆盖默认录制和存储配置
- **任务自动停止**：`dismiss` 时自动停止所有未结束的录制/转写任务
- **分页查询**：事件和任务列表均支持 `filter` + `perPage` + `currentPage` 分页
- **软删除**：所有模型启用 `paranoid` 软删除

### 使用方法

```js
const fastify = require('fastify')();

// 注册依赖插件
await fastify.register(require('@kne/fastify-sequelize'), sequelizeConfig);
await fastify.register(require('@kne/fastify-account'), accountConfig);

// 注册 TRTC 插件
await fastify.register(require('@kne/fastify-trtc'), {
  appId: 1400000000,
  appSecret: 'your-app-secret',
  cos: {
    region: 'ap-guangzhou',
    bucket: 'your-bucket-1250000000',
    accessKeyId: 'your-secret-id',
    accessKeySecret: 'your-secret-key'
  },
  callbackKey: 'your-callback-key'
});

// 使用 Service API
const { services } = fastify.trtc;
const result = await services.join({
  roomId: 'room_001',
  userId: 'user_001'
});
```
