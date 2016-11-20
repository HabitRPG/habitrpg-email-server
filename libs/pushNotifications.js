var nconf = require('nconf');
var pushNotify = require('push-notify');
var Bluebird = require('bluebird');
var gcmLib = require('node-gcm'); // works with FCM notifications too
var AWS = require('aws-sdk');

const FCM_API_KEY = nconf.get('PUSH_CONFIGS:FCM_SERVER_API_KEY');

const fcmSender = FCM_API_KEY ? new gcmLib.Sender(FCM_API_KEY) : undefined;

let apn;

// Load APN certificate and key from S3
const APN_ENABLED = nconf.get('PUSH_CONFIGS:APN_ENABLED') === 'true';


if (APN_ENABLED) {
  if(nconf.get('NODE_ENV') === 'production') {
    const S3_BUCKET = nconf.get('S3:bucket');
    const S3 = new AWS.S3({
      accessKeyId: nconf.get('S3:accessKeyId'),
      secretAccessKey: nconf.get('S3:secretAccessKey'),
    });
    Bluebird.all([
      S3.getObject({
        Bucket: S3_BUCKET,
        Key: 'apple_apn/cert.pem',
      }).promise(),
      S3.getObject({
        Bucket: S3_BUCKET,
        Key: 'apple_apn/key.pem',
      }).promise(),
    ])
      .then(([certObj, keyObj]) => {
        let cert = certObj.Body.toString();
        let key = keyObj.Body.toString();
        configureApn(cert, key);
      });
  } else {
    configureApn('../cert.pem', '../key.pem');
  }
}

function configureApn(cert, key) {
  apn = pushNotify.apn({
    key,
    cert,
  });

  apn.on('error', err => logger.error('APN error', err));
  apn.on('transmissionError', (errorCode, notification, device) => {
    logger.error('APN transmissionError', errorCode, notification, device);
  });
}

function sendNotifications(users, details = {}) {
  users.forEach(user => {
    sendNotification(user, details);
  })
}

function sendNotification (user, details = {}) {
  if (!user) throw new Error('User is required.');
  let pushDevices = user.pushDevices.toObject ? user.pushDevices.toObject() : user.pushDevices;

  if (!details.identifier) throw new Error('details.identifier is required.');
  if (!details.title) throw new Error('details.title is required.');
  if (!details.message) throw new Error('details.message is required.');

  let payload = details.payload ? details.payload : {};
  payload.identifier = details.identifier;

  pushDevices.forEach(pushDevice => {
    switch (pushDevice.type) {
      case 'android':
        // Required for fcm to be received in background
        payload.title = details.title;
        payload.body = details.message;

        if (fcmSender) {
          let message = new gcmLib.Message({
            data: payload,
          });

          fcmSender.send(message, {
            registrationTokens: [pushDevice.regId],
          }, 10, (err) => logger.error('FCM Error', err));
        }
        break;

      case 'ios':
        if (apn) {
          apn.send({
            token: pushDevice.regId,
            alert: details.message,
            sound: 'default',
            category: details.category,
            payload,
          });
        }
        break;
    }
  });
}

module.exports = {
  sendNotification,
};
