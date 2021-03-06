'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var spawn = require('child_process').spawn;
var packageData = require('../../package.json');
var LeWindows = require('./le-windows');
var LeUnix = require('./le-unix');
var shared = require('../shared');

/**
 * Generates a Transport object for Sendmail
 *
 * Possible options can be the following:
 *
 *  * **path** optional path to sendmail binary
 *  * **newline** either 'windows' or 'unix'
 *  * **args** an array of arguments for the sendmail binary
 *
 * @constructor
 * @param {Object} optional config parameter for the AWS Sendmail service
 */

var SendmailTransport = function () {
    function SendmailTransport(options) {
        _classCallCheck(this, SendmailTransport);

        options = options || {};

        // use a reference to spawn for mocking purposes
        this._spawn = spawn;

        this.options = options || {};

        this.name = 'Sendmail';
        this.version = packageData.version;

        this.path = 'sendmail';
        this.args = false;
        this.winbreak = false;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'sendmail'
        });

        if (options) {
            if (typeof options === 'string') {
                this.path = options;
            } else if ((typeof options === 'undefined' ? 'undefined' : _typeof(options)) === 'object') {
                if (options.path) {
                    this.path = options.path;
                }
                if (Array.isArray(options.args)) {
                    this.args = options.args;
                }
                this.winbreak = ['win', 'windows', 'dos', '\r\n'].includes((options.newline || '').toString().toLowerCase());
            }
        }
    }

    /**
     * <p>Compiles a mailcomposer message and forwards it to handler that sends it.</p>
     *
     * @param {Object} emailMessage MailComposer object
     * @param {Function} callback Callback function to run when the sending is completed
     */


    _createClass(SendmailTransport, [{
        key: 'send',
        value: function send(mail, done) {
            var _this = this;

            // Sendmail strips this header line by itself
            mail.message.keepBcc = true;

            var envelope = mail.data.envelope || mail.message.getEnvelope();
            var messageId = mail.message.messageId();
            var args = void 0;
            var sendmail = void 0;
            var returned = void 0;
            var transform = void 0;

            if (this.args) {
                // force -i to keep single dots
                args = ['-i'].concat(this.args).concat(envelope.to);
            } else {
                args = ['-i'].concat(envelope.from ? ['-f', envelope.from] : []).concat(envelope.to);
            }

            var callback = function callback(err) {
                if (returned) {
                    // ignore any additional responses, already done
                    return;
                }
                returned = true;
                if (typeof done === 'function') {
                    if (err) {
                        return done(err);
                    } else {
                        return done(null, {
                            envelope: mail.data.envelope || mail.message.getEnvelope(),
                            messageId: messageId,
                            response: 'Messages queued for delivery'
                        });
                    }
                }
            };

            try {
                sendmail = this._spawn(this.path, args);
            } catch (E) {
                this.logger.error({
                    err: E,
                    tnx: 'spawn',
                    messageId: messageId
                }, 'Error occurred while spawning sendmail. %s', E.message);
                return callback(E);
            }

            if (sendmail) {
                sendmail.on('error', function (err) {
                    _this.logger.error({
                        err: err,
                        tnx: 'spawn',
                        messageId: messageId
                    }, 'Error occurred when sending message %s. %s', messageId, err.message);
                    callback(err);
                });

                sendmail.once('exit', function (code) {
                    if (!code) {
                        return callback();
                    }
                    var err = void 0;
                    if (code === 127) {
                        err = new Error('Sendmail command not found, process exited with code ' + code);
                    } else {
                        err = new Error('Sendmail exited with code ' + code);
                    }

                    _this.logger.error({
                        err: err,
                        tnx: 'stdin',
                        messageId: messageId
                    }, 'Error sending message %s to sendmail. %s', messageId, err.message);
                    callback(err);
                });
                sendmail.once('close', callback);

                sendmail.stdin.on('error', function (err) {
                    _this.logger.error({
                        err: err,
                        tnx: 'stdin',
                        messageId: messageId
                    }, 'Error occurred when piping message %s to sendmail. %s', messageId, err.message);
                    callback(err);
                });

                var recipients = [].concat(envelope.to || []);
                if (recipients.length > 3) {
                    recipients.push('...and ' + recipients.splice(2).length + ' more');
                }
                this.logger.info({
                    tnx: 'send',
                    messageId: messageId
                }, 'Sending message %s to <%s>', messageId, recipients.join(', '));

                transform = this.winbreak ? new LeWindows() : new LeUnix();
                var sourceStream = mail.message.createReadStream();

                transform.once('error', function (err) {
                    _this.logger.error({
                        err: err,
                        tnx: 'stdin',
                        messageId: messageId
                    }, 'Error occurred when generating message %s. %s', messageId, err.message);
                    sendmail.kill('SIGINT'); // do not deliver the message
                    callback(err);
                });

                sourceStream.once('error', function (err) {
                    return transform.emit('error', err);
                });
                sourceStream.pipe(transform).pipe(sendmail.stdin);
            } else {
                return callback(new Error('sendmail was not found'));
            }
        }
    }]);

    return SendmailTransport;
}();

module.exports = SendmailTransport;
