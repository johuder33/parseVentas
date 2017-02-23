var nodemailer = require('nodemailer');
var config = process.env;
// create reusable transporter object using the default SMTP transport
const mailerConfig = {
    host: config.EmailAPI_SERVER,
    port: config.EmailAPI_PORT,
    secure: config.EmailAPI_MAILER_SSL == true,
    auth: {
        user: config.EmailAPI_USER,
        pass: config.EmailAPI_PWD
    }
};

var transporter = nodemailer.createTransport(mailerConfig);

module.exports = transporter;