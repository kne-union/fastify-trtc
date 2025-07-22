module.exports = ({ DataTypes, options }) => {
  return {
    //name: 'modelName',//此处定义modelName，默认根据文件名转驼峰命名，可以缺省
    model: {
      code: {
        type: DataTypes.STRING,
        comment: 'code',
        allowNull: false
      },
      time: {
        type: DataTypes.DATE,
        comment: 'time',
        allowNull: false
      },
      payload: {
        type: DataTypes.STRING,
        comment: '事件详情',
        defaultValue: {}
      }
    },
    associate: ({ instanceEvent, instanceCase }) => {
      instanceEvent.belongsTo(instanceCase, {
        allowNull: false
      });
    },
    options: {
      comment: '从trtc服务获取的事件列表'
    }
  };
};
