const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { models } = fastify[options.name];
  const { Op } = fastify.sequelize.Sequelize;

  const list = async (authenticatePayload, { filter = {}, perPage = 20, currentPage = 1 }) => {
    const where = {};

    if (filter.instanceCaseId) {
      where.trtcInstanceCaseId = filter.instanceCaseId;
    }
    if (filter.code) {
      where.code = filter.code;
    }
    if (filter.startTime && filter.endTime) {
      where.time = { [Op.between]: [new Date(filter.startTime), new Date(filter.endTime)] };
    } else if (filter.startTime) {
      where.time = { [Op.gte]: new Date(filter.startTime) };
    } else if (filter.endTime) {
      where.time = { [Op.lte]: new Date(filter.endTime) };
    }
    if (filter.roomId) {
      const instanceCase = await models.instanceCase.findOne({
        where: { roomId: filter.roomId }
      });
      if (instanceCase) {
        where.trtcInstanceCaseId = instanceCase.id;
      } else {
        return { pageData: [], totalCount: 0 };
      }
    }

    const { rows, count } = await models.instanceEvent.findAndCountAll({
      where,
      offset: perPage * (currentPage - 1),
      limit: perPage,
      order: [['createdAt', 'DESC']]
    });

    return {
      pageData: rows,
      totalCount: count
    };
  };

  const detail = async (authenticatePayload, { id }) => {
    const record = await models.instanceEvent.findByPk(id);
    if (!record) {
      throw fastify.httpErrors.notFound('事件不存在');
    }
    return record;
  };

  Object.assign(fastify[options.name].services, {
    instanceEvent: {
      list,
      detail
    }
  });
});
