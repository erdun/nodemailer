'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var SMTPConnection = require('../smtp-connection');
var assign = require('../shared').assign;
var XOAuth2 = require('../xoauth2');
var EventEmitter = require('events');

/**
 * Creates an element for the pool
 *
 * @constructor
 * @param {Object} options SMTPPool instance
 */

var PoolResource = function (_EventEmitter) {
    _inherits(PoolResource, _EventEmitter);

    function PoolResource(pool) {
        _classCallCheck(this, PoolResource);

        var _this = _possibleConstructorReturn(this, (PoolResource.__proto__ || Object.getPrototypeOf(PoolResource)).call(this));

        _this.pool = pool;
        _this.options = pool.options;
        _this.logger = _this.pool.logger;

        if (_this.options.auth) {
            switch ((_this.options.auth.type || '').toString().toUpperCase()) {
                case 'OAUTH2':
                    {
                        var oauth2 = new XOAuth2(_this.options.auth, _this.logger);
                        oauth2.provisionCallback = _this.pool.mailer && _this.pool.mailer.get('oauth2_provision_cb') || oauth2.provisionCallback;
                        _this.auth = {
                            type: 'OAUTH2',
                            user: _this.options.auth.user,
                            oauth2: oauth2,
                            method: 'XOAUTH2'
                        };
                        oauth2.on('token', function (token) {
                            return _this.pool.mailer.emit('token', token);
                        });
                        oauth2.on('error', function (err) {
                            return _this.emit('error', err);
                        });
                        break;
                    }
                default:
                    _this.auth = {
                        type: 'LOGIN',
                        user: _this.options.auth.user,
                        credentials: {
                            user: _this.options.auth.user || '',
                            pass: _this.options.auth.pass
                        },
                        method: (_this.options.auth.method || '').trim().toUpperCase() || false
                    };
            }
        }

        _this._connection = false;
        _this._connected = false;

        _this.messages = 0;
        _this.available = true;
        return _this;
    }

    /**
     * Initiates a connection to the SMTP server
     *
     * @param {Function} callback Callback function to run once the connection is established or failed
     */


    _createClass(PoolResource, [{
        key: 'connect',
        value: function connect(callback) {
            var _this2 = this;

            this.pool.getSocket(this.options, function (err, socketOptions) {
                if (err) {
                    return callback(err);
                }

                var returned = false;
                var options = _this2.options;
                if (socketOptions && socketOptions.connection) {
                    _this2.logger.info({
                        tnx: 'proxy',
                        remoteAddress: socketOptions.connection.remoteAddress,
                        remotePort: socketOptions.connection.remotePort,
                        destHost: options.host || '',
                        destPort: options.port || '',
                        action: 'connected'
                    }, 'Using proxied socket from %s:%s to %s:%s', socketOptions.connection.remoteAddress, socketOptions.connection.remotePort, options.host || '', options.port || '');

                    options = assign(false, options);
                    Object.keys(socketOptions).forEach(function (key) {
                        options[key] = socketOptions[key];
                    });
                }

                _this2.connection = new SMTPConnection(options);

                _this2.connection.once('error', function (err) {
                    _this2.emit('error', err);
                    if (returned) {
                        return;
                    }
                    returned = true;
                    return callback(err);
                });

                _this2.connection.once('end', function () {
                    _this2.close();
                    if (returned) {
                        return;
                    }
                    returned = true;
                    setTimeout(function () {
                        if (returned) {
                            return;
                        }
                        // still have not returned, this means we have an unexpected connection close
                        var err = new Error('Unexpected socket close');
                        if (_this2.connection && _this2.connection._socket && _this2.connection._socket.upgrading) {
                            // starttls connection errors
                            err.code = 'ETLS';
                        }
                        callback(err);
                    }, 1000).unref();
                });

                _this2.connection.connect(function () {
                    if (returned) {
                        return;
                    }

                    if (_this2.auth) {
                        _this2.connection.login(_this2.auth, function (err) {
                            if (returned) {
                                return;
                            }
                            returned = true;

                            if (err) {
                                _this2.connection.close();
                                _this2.emit('error', err);
                                return callback(err);
                            }

                            _this2._connected = true;
                            callback(null, true);
                        });
                    } else {
                        returned = true;
                        _this2._connected = true;
                        return callback(null, true);
                    }
                });
            });
        }

        /**
         * Sends an e-mail to be sent using the selected settings
         *
         * @param {Object} mail Mail object
         * @param {Function} callback Callback function
         */

    }, {
        key: 'send',
        value: function send(mail, callback) {
            var _this3 = this;

            if (!this._connected) {
                return this.connect(function (err) {
                    if (err) {
                        return callback(err);
                    }
                    return _this3.send(mail, callback);
                });
            }

            var envelope = mail.message.getEnvelope();
            var messageId = mail.message.messageId();

            var recipients = [].concat(envelope.to || []);
            if (recipients.length > 3) {
                recipients.push('...and ' + recipients.splice(2).length + ' more');
            }
            this.logger.info({
                tnx: 'send',
                messageId: messageId,
                cid: this.id
            }, 'Sending message %s using #%s to <%s>', messageId, this.id, recipients.join(', '));

            if (mail.data.dsn) {
                envelope.dsn = mail.data.dsn;
            }

            this.connection.send(envelope, mail.message.createReadStream(), function (err, info) {
                _this3.messages++;

                if (err) {
                    _this3.connection.close();
                    _this3.emit('error', err);
                    return callback(err);
                }

                info.envelope = {
                    from: envelope.from,
                    to: envelope.to
                };
                info.messageId = messageId;

                setImmediate(function () {
                    var err = void 0;
                    if (_this3.messages >= _this3.options.maxMessages) {
                        err = new Error('Resource exhausted');
                        err.code = 'EMAXLIMIT';
                        _this3.connection.close();
                        _this3.emit('error', err);
                    } else {
                        _this3.pool._checkRateLimit(function () {
                            _this3.available = true;
                            _this3.emit('available');
                        });
                    }
                });

                callback(null, info);
            });
        }

        /**
         * Closes the connection
         */

    }, {
        key: 'close',
        value: function close() {
            this._connected = false;
            if (this.auth && this.auth.oauth2) {
                this.auth.oauth2.removeAllListeners();
            }
            if (this.connection) {
                this.connection.close();
            }
            this.emit('close');
        }
    }]);

    return PoolResource;
}(EventEmitter);

module.exports = PoolResource;
