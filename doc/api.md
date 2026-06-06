### 配置项

| 属性名                   | 类型         | 必填 | 默认值         | 说明                      |
|-----------------------|------------|----|-------------|-------------------------|
| `appId`               | `number`   | 是  | -           | 腾讯云 TRTC 应用 ID          |
| `appSecret`           | `string`   | 是  | -           | 腾讯云 TRTC 应用密钥           |
| `dbTableNamePrefix`   | `string`   | 否  | `t_`        | 数据库表名前缀                 |
| `name`                | `string`   | 否  | `trtc`      | 插件命名空间名称                |
| `prefix`              | `string`   | 否  | `/api/trtc` | 路由前缀                    |
| `callbackKey`         | `string`   | 否  | `''`        | 回调签名密钥，为空则跳过签名校验        |
| `getParams`           | `function` | 否  | -           | 自定义参数获取函数，接收合并后参数返回最终参数 |
| `getAuthenticate`     | `function` | 否  | 见下方         | 按功能分类返回认证中间件数组          |
| `cos.region`          | `string`   | 是  | `''`        | COS 存储桶地域               |
| `cos.bucket`          | `string`   | 是  | `''`        | COS 存储桶名称               |
| `cos.accessKeyId`     | `string`   | 是  | `''`        | COS SecretId            |
| `cos.accessKeySecret` | `string`   | 是  | `''`        | COS SecretKey           |

`getAuthenticate` 默认实现：

```js
(type) => {
  const { authenticate } = fastify.account;
  switch (type) {
    case 'instanceEvent':
    case 'task':
    default:
      return [authenticate.user, authenticate.admin];
  }
}
```

### 接口

#### POST `/api/trtc/callback`

TRTC 事件回调接口，由腾讯云服务端调用。

请求体：

| 属性名            | 类型       | 必填 | 说明     |
|----------------|----------|----|--------|
| `EventGroupId` | `number` | 是  | 事件组 ID |
| `EventType`    | `number` | 是  | 事件类型码  |
| `CallbackTs`   | `number` | 是  | 回调时间戳  |
| `EventInfo`    | `object` | 是  | 事件详情   |

请求头：

| 属性名    | 说明                                  |
|--------|-------------------------------------|
| `sign` | HMAC-SHA256 签名（`callbackKey` 非空时校验） |

返回：

```json
// 成功
{
  "code": 0
}

// 签名校验失败（HTTP 403）
{
  "code": 1,
  "message": "签名校验失败"
}
```

#### GET `/api/trtc/instance-event/list`

事件列表查询（分页）。

| 参数名                     | 类型       | 必填 | 默认值  | 说明               |
|-------------------------|----------|----|------|------------------|
| `filter.instanceCaseId` | `string` | 否  | -    | 按房间实例 ID 筛选      |
| `filter.roomId`         | `string` | 否  | -    | 按房间 ID 筛选        |
| `filter.code`           | `string` | 否  | -    | 按事件类型码筛选         |
| `filter.startTime`      | `string` | 否  | -    | 时间范围起始（ISO 8601） |
| `filter.endTime`        | `string` | 否  | -    | 时间范围截止（ISO 8601） |
| `perPage`               | `number` | 否  | `20` | 每页条数             |
| `currentPage`           | `number` | 否  | `1`  | 当前页码             |

返回：

```json
{
  "pageData": [
    {
      "id": "...",
      "code": "103",
      "time": "...",
      "payload": {},
      "createdAt": "..."
    }
  ],
  "totalCount": 100
}
```

#### GET `/api/trtc/instance-event/detail`

事件详情查询。

| 参数名  | 类型       | 必填 | 说明      |
|------|----------|----|---------|
| `id` | `string` | 是  | 事件记录 ID |

#### GET `/api/trtc/task/list`

任务列表查询（分页）。

| 参数名                     | 类型        | 必填 | 默认值  | 说明                                 |
|-------------------------|-----------|----|------|------------------------------------|
| `filter.instanceCaseId` | `string`  | 否  | -    | 按房间实例 ID 筛选                        |
| `filter.roomId`         | `string`  | 否  | -    | 按房间 ID 筛选                          |
| `filter.type`           | `string`  | 否  | -    | 任务类型：`record` / `ai_transcription` |
| `filter.taskId`         | `string`  | 否  | -    | 按腾讯云任务 ID 筛选                       |
| `filter.active`         | `boolean` | 否  | -    | `true`=进行中，`false`=已停止             |
| `filter.startTime`      | `string`  | 否  | -    | 开始时间范围起始（ISO 8601）                 |
| `filter.endTime`        | `string`  | 否  | -    | 开始时间范围截止（ISO 8601）                 |
| `perPage`               | `number`  | 否  | `20` | 每页条数                               |
| `currentPage`           | `number`  | 否  | `1`  | 当前页码                               |

返回：

```json
{
  "pageData": [
    {
      "id": "...",
      "type": "record",
      "taskId": "...",
      "startTime": "...",
      "stopTime": null,
      "result": null
    }
  ],
  "totalCount": 50
}
```

#### GET `/api/trtc/task/detail`

任务详情查询。

| 参数名  | 类型       | 必填 | 说明      |
|------|----------|----|---------|
| `id` | `string` | 是  | 任务记录 ID |

### 程序化 API

通过 `fastify.trtc.services` 访问所有 Service 方法。

#### main 模块

| 方法签名                                                                       | 说明                                                    |
|----------------------------------------------------------------------------|-------------------------------------------------------|
| `join({ roomId, userId, options })`                                        | 加入房间，返回 `{ userSig, id, roomId, options, startTime }` |
| `exit({ roomId, userId })`                                                 | 退出房间，更新 userList                                      |
| `dismiss({ roomId, options })`                                             | 解散房间，自动停止所有未完成任务                                      |
| `removeMember({ userId, roomId, options })`                                | 将用户从房间移除                                              |
| `startRecord({ roomId, options, recordParams, storageParams })`            | 开始云端录制，`recordParams`/`storageParams` 可覆盖默认配置         |
| `stopRecord({ id, roomId })`                                               | 停止云端录制                                                |
| `checkRecord({ id, roomId })`                                              | 检查录制结果，若 COS 文件已就绪则更新 task.result                     |
| `startAITranscription({ roomId, language, hotWordList, taskId, options })` | 开始 AI 转写                                              |
| `stopAITranscription({ id, roomId })`                                      | 停止 AI 转写                                              |

#### webhook 模块

| 方法签名                         | 说明                                  |
|------------------------------|-------------------------------------|
| `verifySign({ sign, body })` | 校验回调签名，`callbackKey` 为空时始终返回 `true` |
| `dispatch(input)`            | 事件分发，按 EventGroupId 路由到对应处理器        |

#### cos 模块

| 方法签名                                 | 说明                                  |
|--------------------------------------|-------------------------------------|
| `createClient()`                     | 获取 COS 客户端单例                        |
| `getFileIdsByPathName({ pathname })` | 按路径前缀获取 COS 文件并转存到 fileManager      |
| `getFileIdsByFileKey({ keys })`      | 按文件 Key 精确获取 COS 文件并转存到 fileManager |

#### instanceEvent 模块

| 方法签名                                                          | 说明     |
|---------------------------------------------------------------|--------|
| `list(authenticatePayload, { filter, perPage, currentPage })` | 事件分页列表 |
| `detail(authenticatePayload, { id })`                         | 事件详情   |

#### task 模块

| 方法签名                                                          | 说明     |
|---------------------------------------------------------------|--------|
| `list(authenticatePayload, { filter, perPage, currentPage })` | 任务分页列表 |
| `detail(authenticatePayload, { id })`                         | 任务详情   |

### 数据模型

#### instanceCase

TRTC 房间使用实例。

| 属性名         | 类型       | 说明                                                                      |
|-------------|----------|-------------------------------------------------------------------------|
| `roomId`    | `string` | 房间 ID                                                                   |
| `userList`  | `JSON`   | 参与用户列表，key 为 userId，value 包含 `startTime`/`status`/`userSig`/`options` 等 |
| `startTime` | `Date`   | 第一个用户实际进入会议的时间                                                          |
| `endTime`   | `Date`   | 实际结束时间                                                                  |
| `options`   | `JSON`   | 扩展字段                                                                    |

索引：`room_id` 唯一索引（`deleted_at` 为 NULL 时生效）

#### task

TRTC 任务记录。

| 属性名              | 类型                                   | 说明          |
|------------------|--------------------------------------|-------------|
| `type`           | `ENUM('record', 'ai_transcription')` | 任务类型        |
| `startRequestId` | `string`                             | 启动任务的请求 ID  |
| `stopRequestId`  | `string`                             | 停止任务的请求 ID  |
| `taskId`         | `string`                             | 腾讯云返回的任务 ID |
| `result`         | `JSON`                               | 任务完成结果      |
| `startTime`      | `Date`                               | 任务开始时间      |
| `stopTime`       | `Date`                               | 任务结束时间      |
| `options`        | `JSON`                               | 扩展字段        |

关联：`belongsTo(instanceCase)`

索引：`task_id` 唯一索引（`deleted_at` 为 NULL 时生效）

#### instanceEvent

TRTC 事件记录。

| 属性名       | 类型       | 说明                                                                      |
|-----------|----------|-------------------------------------------------------------------------|
| `code`    | `string` | 事件类型码                                                                   |
| `time`    | `Date`   | 事件发生时间                                                                  |
| `payload` | `JSON`   | 事件详情，包含 `eventGroupId`/`eventType`/`roomId`/`userId`/`taskId`/`payload` |

关联：`belongsTo(instanceCase)`

索引：`instance_case_id` 普通索引

### 机制说明

#### 签名校验

回调接口使用 HMAC-SHA256 签名校验：

1. 腾讯云将请求体用 `callbackKey` 做 HMAC-SHA256，结果放在 `sign` 请求头
2. 插件收到回调后用相同算法计算签名，与请求头比对
3. `callbackKey` 为空时跳过校验

#### 事件码映射

##### 房间事件 (EventGroupId=1)

| EventType | 说明   | 业务处理                                                  |
|-----------|------|-------------------------------------------------------|
| 101       | 创建房间 | 记录事件                                                  |
| 102       | 解散房间 | 记录事件 + 更新 `instanceCase.endTime`                      |
| 103       | 进入房间 | 记录事件 + 更新 `userList` 状态 + 设置 `instanceCase.startTime` |
| 104       | 退出房间 | 记录事件 + 更新 `userList` exitTime/reason                  |
| 105       | 切换角色 | 记录事件                                                  |

##### 媒体事件 (EventGroupId=2)

| EventType | 说明         |
|-----------|------------|
| 201-206   | 音视频流状态变更事件 |

##### 云端录制事件 (EventGroupId=3)

| EventType | 说明           | 业务处理                                           |
|-----------|--------------|------------------------------------------------|
| 301       | 录制模块启动       | 记录事件                                           |
| 302       | 录制模块退出       | 记录事件                                           |
| 303       | 上传任务启动       | 记录事件                                           |
| 304       | 生成 m3u8 索引文件 | 记录事件                                           |
| 305       | 上传结束         | 记录事件                                           |
| 306       | 录制迁移         | 记录事件                                           |
| 307       | 生成 m3u8 切片   | 记录事件                                           |
| 309       | 下载解码图片错误     | 记录事件                                           |
| 310       | MP4 录制结束     | 记录事件 + 转存文件 + 更新 `task.result`/`task.stopTime` |
| 311       | VOD 上传完成     | 记录事件 + 更新 `task.options.vodCommit`             |
| 312       | VOD 任务结束     | 记录事件 + 更新 `task.stopTime`                      |

##### 页面录制事件 (EventGroupId=8)

| EventType | 说明         |
|-----------|------------|
| 801-804   | 页面录制生命周期事件 |

##### AI 转写事件 (EventType=903)

累积转写轮次到 `task.result.rounds`，并更新 `task.options.lastRound` 为最新一轮。

#### 录制参数默认值

| 参数             | 默认值  | 说明        |
|----------------|------|-----------|
| `RecordMode`   | `1`  | 合流录制      |
| `MaxIdleTime`  | `30` | 最大空闲时间（秒） |
| `StreamType`   | `0`  | 主音视频流     |
| `OutputFormat` | `3`  | HLS 格式    |
| `RoomIdType`   | `0`  | 字符串房间号类型  |
| `Vendor`       | `0`  | 腾讯云存储     |

可通过 `startRecord` 的 `recordParams` 和 `storageParams` 参数覆盖对应配置。
