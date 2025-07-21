module.exports = ({ DataTypes, options }) => {
  return {
    model: {
      type: {
        type: DataTypes.ENUM('record', 'ai_transcription'),
        comment: '类型',
        allowNull: false
      },
      startRequestId: {
        type: DataTypes.STRING,
        comment: '开始任务请求ID',
        allowNull: false
      },
      stopRequestId: {
        type: DataTypes.STRING,
        comment: '结束任务请求ID'
      },
      taskId: {
        type: DataTypes.STRING,
        comment: '任务ID',
        allowNull: false
      },
      result: {
        type: DataTypes.JSON,
        comment: '任务完成结果'
      },
      startTime: {
        type: DataTypes.DATE,
        comment: '开始时间'
      },
      stopTime: {
        type: DataTypes.DATE,
        comment: '结束时间'
      },
      options: {
        type: DataTypes.JSON,
        comment: '扩展字段'
      }
    },
    associate: ({ task, instanceCase }) => {
      task.belongsTo(instanceCase, {
        allowNull: null
      });
    },
    options: {
      comment: 'TRTC任务',
      indexes: [
        {
          fields: ['task_id', 'delete_at'],
          unique: true
        },
        {
          fields: ['room_id']
        }
      ]
    }
  };
};
