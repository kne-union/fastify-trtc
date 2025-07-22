module.exports = ({ DataTypes, options }) => {
  return {
    model: {
      roomId: {
        type: DataTypes.STRING,
        comment: '房间ID',
        allowNull: false
      },
      userList: {
        type: DataTypes.JSON,
        comment: '参与用户',
        defaultValue: {}
      },
      startTime: {
        type: DataTypes.DATE,
        comment: '开始时间(第一个人实际进入会议时间)'
      },
      endTime: {
        type: DataTypes.DATE,
        comment: '实际结束时间，用户自己结束会议或者通过事件分析房间所有人都下线'
      },
      options: {
        type: DataTypes.JSON,
        comment: '扩展字段',
        defaultValue: {}
      }
    },
    options: {
      comment: 'trtc的使用实例',
      indexes: [
        {
          fields: ['room_id', 'deleted_at'],
          unique: true
        }
      ]
    }
  };
};
