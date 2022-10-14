import nconf from 'nconf';

const BATCH_SIZE = nconf.get('USERS_BATCH');

function findEntities (collection, job, lastId, query, processor, fields, batchSize) {
    if (lastId) {
        // Assuming linear distribution, this roughly gets us the progress the job
        job.progress(('0123456789abcdef'.indexOf(lastId[0]) / 16) * 100);
        query._id = {
            $gt: lastId,
        };
    }
  
    let foundNumber;
    let newLastId;
  
    return collection.find(query, {
      sort: { _id: 1 },
      limit: batchSize ? batchSize : BATCH_SIZE,
      fields: fields ? fields : ['_id', 'apiToken', 'auth', 'purchased.plan'],
    })
      .then(entities => {
        foundNumber = entities.length;
        newLastId = foundNumber > 0 ? entities[foundNumber - 1]._id : null;
  
        return Promise.all(entities.map(entity => processor(entity)));
      }).then(() => {
        if (foundNumber === BATCH_SIZE) {
          return findEntities(collection, job, newLastId, query, processor, batchSize);
        }
        job.progress(100) ;
        return true;
      });
  };
  
  export default findEntities;
  