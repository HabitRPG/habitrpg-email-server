import nconf from 'nconf';
import pushNotify from 'push-notify';
import bluebird from 'bluebird';
import { Sender, Message } from 'node-gcm'; // works with FCM notifications too
import aws from 'aws-sdk';

var FCM_API_KEY = nconf.get('PUSH_CONFIGS:FCM_SERVER_API_KEY');

var fcmSender = FCM_API_KEY ? new Sender(FCM_API_KEY) : undefined;

var apn;

// Load APN certificate and key from S3
var APN_ENABLED = nconf.get('PUSH_CONFIGS:APN_ENABLED') === 'true';


if (APN_ENABLED) {
  if(nconf.get('NODE_ENV') === 'production') {
    var S3_BUCKET = nconf.get('S3:bucket');
    var S3 = new aws.S3({
      accessKeyId: nconf.get('S3:accessKeyId'),
      secretAccessKey: nconf.get('S3:secretAccessKey'),
    });
    bluebird.all([
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
        var cert = certObj.Body.toString();
        var key = keyObj.Body.toString();
        configureApn(cert, key);
      });
  } else {
    configureApn('./cert.pem', './key.pem');
  }
}

function configureApn(cert, key) {
  apn = pushNotify.apn({
    key,
    cert,
    production: true,
  });

  apn.on('error', err => console.log('APN error', err));
  apn.on('transmissionError', (errorCode, notification, device) => {
    console.log('APN transmissionError', errorCode, notification, device);
  });
}

function sendNotifications(users, details) {
  users.forEach(user => {
    sendNotification(user, details);
  })
}

function sendNotification (user, details) {
  if (!user) throw new Error('User is required.');
  var pushDevices = user.pushDevices;

  if (details === undefined) details = {};

  if (!details.identifier) throw new Error('details.identifier is required.');
  if (!details.title) throw new Error('details.title is required.');
  if (!details.message) throw new Error('details.message is required.');

  var payload = details.payload ? details.payload : {};
  payload.identifier = details.identifier;

  pushDevices.forEach(pushDevice => {
    switch (pushDevice.type) {
      case 'android':
        // Required for fcm to be received in background
        payload.title = details.title;
        payload.body = details.message;

        if (fcmSender) {
          var message = new Message({
            data: payload,
          });

          fcmSender.send(message, {
            registrationTokens: [pushDevice.regId],
          }, 10, (err) => {
            if (err) console.log('FCM Error', err);
          });
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

export {
  sendNotification,
};
