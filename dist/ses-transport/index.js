'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var EventEmitter = require('events');
var packageData = require('../../package.json');
var shared = require('../shared');
var LeWindows = require('../sendmail-transport/le-windows');

/**
 * Generates a Transport object for Sendmail
 *
 * Possible options can be the following:
 *
 *  * **path** optional path to sendmail binary
 *  * **args** an array of arguments for the sendmail binary
 *
 * @constructor
 * @param {Object} optional config parameter for the AWS Sendmail service
 */

var SESTransport = function (_EventEmitter) {
    _inherits(SESTransport, _EventEmitter);

    function SESTransport(options) {
        _classCallCheck(this, SESTransport);

        var _this = _possibleConstructorReturn(this, (SESTransport.__proto__ || Object.getPrototypeOf(SESTransport)).call(this));

        options = options || {};

        _this.options = options || {};
        _this.ses = _this.options.SES;

        _this.name = 'SESTransport';
        _this.version = packageData.version;

        _this.logger = shared.getLogger(_this.options, {
            component: _this.options.component || 'ses-transport'
        });

        // parallel sending connections
        _this.maxConnections = Number(_this.options.maxConnections) || Infinity;
        _this.connections = 0;

        // max messages per second
        _this.sendingRate = Number(_this.options.sendingRate) || Infinity;
        _this.sendingRateTTL = null;
        _this.rateInterval = 1000;
        _this.rateMessages = [];

        _this.pending = [];

        _this.idling = true;

        setImmediate(function () {
            if (_this.idling) {
                _this.emit('idle');
            }
        });
        return _this;
    }

    /**
     * Schedules a sending of a message
     *
     * @param {Object} emailMessage MailComposer object
     * @param {Function} callback Callback function to run when the sending is completed
     */


    _createClass(SESTransport, [{
        key: 'send',
        value: function send(mail, callback) {
            var _this2 = this;

            if (this.connections >= this.maxConnections) {
                this.idling = false;
                return this.pending.push({
                    mail: mail,
                    callback: callback
                });
            }

            if (!this._checkSendingRate()) {
                this.idling = false;
                return this.pending.push({
                    mail: mail,
                    callback: callback
                });
            }

            this._send(mail, function () {
                for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
                    args[_key] = arguments[_key];
                }

                setImmediate(function () {
                    return callback.apply(undefined, args);
                });
                _this2._sent();
            });
        }
    }, {
        key: '_checkRatedQueue',
        value: function _checkRatedQueue() {
            var _this3 = this;

            if (this.connections >= this.maxConnections || !this._checkSendingRate()) {
                return;
            }

            if (!this.pending.length) {
                if (!this.idling) {
                    this.idling = true;
                    this.emit('idle');
                }
                return;
            }

            var next = this.pending.shift();
            this._send(next.mail, function () {
                for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
                    args[_key2] = arguments[_key2];
                }

                setImmediate(function () {
                    return next.callback.apply(next, args);
                });
                _this3._sent();
            });
        }
    }, {
        key: '_checkSendingRate',
        value: function _checkSendingRate() {
            var _this4 = this;

            clearTimeout(this.sendingRateTTL);

            var now = Date.now();
            var oldest = false;
            // delete older messages
            for (var i = this.rateMessages.length - 1; i >= 0; i--) {

                if (this.rateMessages[i].ts >= now - this.rateInterval && (!oldest || this.rateMessages[i].ts < oldest)) {
                    oldest = this.rateMessages[i].ts;
                }

                if (this.rateMessages[i].ts < now - this.rateInterval && !this.rateMessages[i].pending) {
                    this.rateMessages.splice(i, 1);
                }
            }

            if (this.rateMessages.length < this.sendingRate) {
                return true;
            }

            var delay = Math.max(oldest + 1001, now + 20);
            this.sendingRateTTL = setTimeout(function () {
                return _this4._checkRatedQueue();
            }, now - delay);
            this.sendingRateTTL.unref();
            return false;
        }
    }, {
        key: '_sent',
        value: function _sent() {
            this.connections--;
            this._checkRatedQueue();
        }

        /**
         * Returns true if there are free slots in the queue
         */

    }, {
        key: 'isIdle',
        value: function isIdle() {
            return this.idling;
        }

        /**
         * Compiles a mailcomposer message and forwards it to SES
         *
         * @param {Object} emailMessage MailComposer object
         * @param {Function} callback Callback function to run when the sending is completed
         */

    }, {
        key: '_send',
        value: function _send(mail, callback) {
            var _this5 = this;

            var statObject = {
                ts: Date.now(),
                pending: true
            };
            this.connections++;
            this.rateMessages.push(statObject);

            var envelope = mail.data.envelope || mail.message.getEnvelope();
            var messageId = mail.message.messageId();

            var recipients = [].concat(envelope.to || []);
            if (recipients.length > 3) {
                recipients.push('...and ' + recipients.splice(2).length + ' more');
            }
            this.logger.info({
                tnx: 'send',
                messageId: messageId
            }, 'Sending message %s to <%s>', messageId, recipients.join(', '));

            var getRawMessage = function getRawMessage(next) {

                // do not use Message-ID and Date in DKIM signature
                if (!mail.data._dkim) {
                    mail.data._dkim = {};
                }
                if (mail.data._dkim.skipFields && typeof mail.data._dkim.skipFields === 'string') {
                    mail.data._dkim.skipFields += ':date:message-id';
                } else {
                    mail.data._dkim.skipFields = 'date:message-id';
                }

                var sourceStream = mail.message.createReadStream();
                var stream = sourceStream.pipe(new LeWindows());
                var chunks = [];
                var chunklen = 0;

                stream.on('readable', function () {
                    var chunk = void 0;
                    while ((chunk = stream.read()) !== null) {
                        chunks.push(chunk);
                        chunklen += chunk.length;
                    }
                });

                sourceStream.once('error', function (err) {
                    return stream.emit('error', err);
                });

                stream.once('error', function (err) {
                    next(err);
                });

                stream.once('end', function () {
                    return next(null, Buffer.concat(chunks, chunklen));
                });
            };

            setImmediate(function () {
                return getRawMessage(function (err, raw) {
                    if (err) {
                        _this5.logger.error({
                            err: err,
                            tnx: 'send',
                            messageId: messageId
                        }, 'Failed creating message for %s. %s', messageId, err.message);
                        statObject.pending = false;
                        return callback(err);
                    }

                    var sesMessage = {
                        RawMessage: { // required
                            Data: raw // required
                        },
                        Source: envelope.from,
                        Destinations: envelope.to
                    };

                    Object.keys(mail.data.ses || {}).forEach(function (key) {
                        sesMessage[key] = mail.data.ses[key];
                    });

                    _this5.ses.sendRawEmail(sesMessage, function (err, data) {
                        if (err) {
                            _this5.logger.error({
                                err: err,
                                tnx: 'send'
                            }, 'Send error for %s: %s', messageId, err.message);
                            statObject.pending = false;
                            return callback(err);
                        }

                        var region = _this5.ses.config && _this5.ses.config.region || 'us-east-1';
                        if (region === 'us-east-1') {
                            region = 'email';
                        }

                        statObject.pending = false;
                        callback(null, {
                            envelope: {
                                from: envelope.from,
                                to: envelope.to
                            },
                            messageId: '<' + data.MessageId + (!/@/.test(data.MessageId) ? '@' + region + '.amazonses.com' : '') + '>',
                            response: data.MessageId
                        });
                    });
                });
            });
        }

        /**
         * Verifies SES configuration
         *
         * @param {Function} callback Callback function
         */

    }, {
        key: 'verify',
        value: function verify(callback) {
            var promise = void 0;

            if (!callback && typeof Promise === 'function') {
                promise = new Promise(function (resolve, reject) {
                    callback = shared.callbackPromise(resolve, reject);
                });
            }

            this.ses.sendRawEmail({
                RawMessage: { // required
                    Data: 'From: invalid@invalid\r\nTo: invalid@invalid\r\n Subject: Invalid\r\n\r\nInvalid'
                },
                Source: 'invalid@invalid',
                Destinations: ['invalid@invalid']
            }, function (err) {
                if (err && err.code !== 'InvalidParameterValue') {
                    return callback(err);
                }
                return callback(null, true);
            });

            return promise;
        }
    }]);

    return SESTransport;
}(EventEmitter);

module.exports = SESTransport;
