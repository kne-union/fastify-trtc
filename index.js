const fp = require('fastify-plugin');
const path = require('node:path');

module.exports = fp(async (fastify, options) => {
  options = Object.assign({}, {
    dbTableNamePrefix: 't_', name: 'trtc', prefix: '/api/trtc', callbackKey: '', getAuthenticate: (type) => {
      if (!fastify.account) {
        return [() => {
          throw new Error('fastify.account plugin not found');
        }];
      }
      const { authenticate } = fastify.account;
      switch (type) {
        case 'instanceEvent':
        case 'task':
        default:
          return [authenticate.user, authenticate.admin];
      }
    },
    enableRestApiQuery: false,
    cos: {
      region: '', bucket: '', accessKeyId: '', accessKeySecret: ''
    }
  }, options);

  fastify.register(require('@kne/fastify-namespace'), {
    options,
    name: options.name,
    modules: [['controllers', path.resolve(__dirname, './libs/controllers')], ['models', await fastify.sequelize.addModels(path.resolve(__dirname, './libs/models'), {
      prefix: options.dbTableNamePrefix, modelPrefix: options.name
    })], ['services', path.resolve(__dirname, './libs/services')]]
  });
}, {
  name: 'fastify-trtc'
});
