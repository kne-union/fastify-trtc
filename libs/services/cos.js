const fp = require('fastify-plugin');
const COS = require('cos-nodejs-sdk-v5');

module.exports = fp(async (fastify, options) => {
  const createClient = () => {
    return new COS({
      SecretId: options.cos.accessKeyId,
      SecretKey: options.cos.accessKeySecret,
      Region: options.cos.region
    });
  };

  const getFileIdsByPathName = async ({ pathname }) => {
    const cos = createClient();
    const { Contents } = await cos.getBucket({
      Bucket: options.cos.bucket,
      Region: options.cos.region,
      Prefix: `${pathname}/`
    });
    return await Promise.all(
      Contents.map(async item => {
        const url = cos.getObjectUrl({
          Bucket: options.cos.bucket,
          Region: options.cos.region,
          Key: item.Key,
          Sign: true
        });
        const { id: fileId } = await fastify.fileManager.services.uploadFromUrl({ url });
        await cos.deleteObject({
          Bucket: options.cos.bucket,
          Region: options.cos.region,
          Key: item.Key
        });
        return fileId;
      })
    );
  };

  const getFileIdsByFileKey = async ({ keys }) => {
    return await Promise.all(
      keys.map(async fileKey => {
        const cos = createClient();
        const url = cos.getObjectUrl({
          Bucket: options.cos.bucket,
          Region: options.cos.region,
          Key: fileKey,
          Sign: true
        });
        const { id: fileId } = await fastify.fileManager.services.uploadFromUrl({ url });
        await cos.deleteObject({
          Bucket: options.cos.bucket,
          Region: options.cos.region,
          Key: fileKey
        });
        return fileId;
      })
    );
  };

  Object.assign(fastify[options.name].services, {
    cos: {
      createClient,
      getFileIdsByPathName,
      getFileIdsByFileKey
    }
  });
});
