'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var EventEmitter = require('events');
var PoolResource = require('./pool-resource');
var SMTPConnection = require('../smtp-connection');
var wellKnown = require('../well-known');
var shared = require('../shared');
var packageData = require('../../package.json');

/**
 * Creates a SMTP pool transport object for Nodemailer
 *
 * @constructor
 * @param {Object} options SMTP Connection options
 */

var SMTPPool = function (_EventEmitter) {
    _inherits(SMTPPool, _EventEmitter);

    function SMTPPool(options) {
        _classCallCheck(this, SMTPPool);

        var _this = _possibleConstructorReturn(this, (SMTPPool.__proto__ || Object.getPrototypeOf(SMTPPool)).call(this));

        options = options || {};
        if (typeof options === 'string') {
            options = {
                url: options
            };
        }

        var urlData = void 0;
        var service = options.service;

        if (typeof options.getSocket === 'function') {
            _this.getSocket = options.getSocket;
        }

        if (options.url) {
            urlData = shared.parseConnectionUrl(options.url);
            service = service || urlData.service;
        }

        _this.options = shared.assign(false, // create new object
        options, // regular options
        urlData, // url options
        service && wellKnown(service) // wellknown options
        );

        _this.options.maxConnections = _this.options.maxConnections || 5;
        _this.options.maxMessages = _this.options.maxMessages || 100;

        _this.logger = shared.getLogger(_this.options, {
            component: _this.options.component || 'smtp-pool'
        });

        // temporary object
        var connection = new SMTPConnection(_this.options);

        _this.name = 'SMTP (pool)';
        _this.version = packageData.version + '[client:' + connection.version + ']';

        _this._rateLimit = {
            counter: 0,
            timeout: null,
            waiting: [],
            checkpoint: false,
            delta: Number(_this.options.rateDelta) || 1000,
            limit: Number(_this.options.rateLimit) || 0
        };
        _this._closed = false;
        _this._queue = [];
        _this._connections = [];
        _this._connectionCounter = 0;

        _this.idling = true;

        setImmediate(function () {
            if (_this.idling) {
                _this.emit('idle');
            }
        });
        return _this;
    }

    /**
     * Placeholder function for creating proxy sockets. This method immediatelly returns
     * without a socket
     *
     * @param {Object} options Connection options
     * @param {Function} callback Callback function to run with the socket keys
     */


    _createClass(SMTPPool, [{
        key: 'getSocket',
        value: function getSocket(options, callback) {
            // return immediatelly
            return setImmediate(function () {
                return callback(null, false);
            });
        }

        /**
         * Queues an e-mail to be sent using the selected settings
         *
         * @param {Object} mail Mail object
         * @param {Function} callback Callback function
         */

    }, {
        key: 'send',
        value: function send(mail, callback) {
            var _this2 = this;

            if (this._closed) {
                return false;
            }

            this._queue.push({
                mail: mail,
                callback: callback
            });

            if (this.idling && this._queue.length >= this.options.maxConnections) {
                this.idling = false;
            }

            setImmediate(function () {
                return _this2._processMessages();
            });

            return true;
        }

        /**
         * Closes all connections in the pool. If there is a message being sent, the connection
         * is closed later
         */

    }, {
        key: 'close',
        value: function close() {
            var _this3 = this;

            var connection = void 0;
            var len = this._connections.length;
            this._closed = true;

            // clear rate limit timer if it exists
            clearTimeout(this._rateLimit.timeout);

            if (!len && !this._queue.length) {
                return;
            }

            // remove all available connections
            for (var i = len - 1; i >= 0; i--) {
                if (this._connections[i] && this._connections[i].available) {
                    connection = this._connections[i];
                    connection.close();
                    this.logger.info({
                        tnx: 'connection',
                        cid: connection.id,
                        action: 'removed'
                    }, 'Connection #%s removed', connection.id);
                }
            }

            if (len && !this._connections.length) {
                this.logger.debug({
                    tnx: 'connection'
                }, 'All connections removed');
            }

            if (!this._queue.length) {
                return;
            }

            // make sure that entire queue would be cleaned
            var invokeCallbacks = function invokeCallbacks() {
                if (!_this3._queue.length) {
                    _this3.logger.debug({
                        tnx: 'connection'
                    }, 'Pending queue entries cleared');
                    return;
                }
                var entry = _this3._queue.shift();
                if (entry && typeof entry.callback === 'function') {
                    try {
                        entry.callback(new Error('Connection pool was closed'));
                    } catch (E) {
                        _this3.logger.error({
                            err: E,
                            tnx: 'callback',
                            cid: connection.id
                        }, 'Callback error for #%s: %s', connection.id, E.message);
                    }
                }
                setImmediate(invokeCallbacks);
            };
            setImmediate(invokeCallbacks);
        }

        /**
         * Check the queue and available connections. If there is a message to be sent and there is
         * an available connection, then use this connection to send the mail
         */

    }, {
        key: '_processMessages',
        value: function _processMessages() {
            var _this4 = this;

            var connection = void 0;
            var i = void 0,
                len = void 0;

            // do nothing if already closed
            if (this._closed) {
                return;
            }

            // do nothing if queue is empty
            if (!this._queue.length) {
                if (!this.idling) {
                    // no pending jobs
                    this.idling = true;
                    this.emit('idle');
                }
                return;
            }

            // find first available connection
            for (i = 0, len = this._connections.length; i < len; i++) {
                if (this._connections[i].available) {
                    connection = this._connections[i];
                    break;
                }
            }

            if (!connection && this._connections.length < this.options.maxConnections) {
                connection = this._createConnection();
            }

            if (!connection) {
                // no more free connection slots available
                this.idling = false;
                return;
            }

            // check if there is free space in the processing queue
            if (!this.idling && this._queue.length < this.options.maxConnections) {
                this.idling = true;
                this.emit('idle');
            }

            var entry = connection.queueEntry = this._queue.shift();
            entry.messageId = (connection.queueEntry.mail.message.getHeader('message-id') || '').replace(/[<>\s]/g, '');

            connection.available = false;

            this.logger.debug({
                tnx: 'pool',
                cid: connection.id,
                messageId: entry.messageId,
                action: 'assign'
            }, 'Assigned message <%s> to #%s (%s)', entry.messageId, connection.id, connection.messages + 1);

            if (this._rateLimit.limit) {
                this._rateLimit.counter++;
                if (!this._rateLimit.checkpoint) {
                    this._rateLimit.checkpoint = Date.now();
                }
            }

            connection.send(entry.mail, function (err, info) {
                // only process callback if current handler is not changed
                if (entry === connection.queueEntry) {
                    try {
                        entry.callback(err, info);
                    } catch (E) {
                        _this4.logger.error({
                            err: E,
                            tnx: 'callback',
                            cid: connection.id
                        }, 'Callback error for #%s: %s', connection.id, E.message);
                    }
                    connection.queueEntry = false;
                }
            });
        }

        /**
         * Creates a new pool resource
         */

    }, {
        key: '_createConnection',
        value: function _createConnection() {
            var _this5 = this;

            var connection = new PoolResource(this);

            connection.id = ++this._connectionCounter;

            this.logger.info({
                tnx: 'pool',
                cid: connection.id,
                action: 'conection'
            }, 'Created new pool resource #%s', connection.id);

            // resource comes available
            connection.on('available', function () {
                _this5.logger.debug({
                    tnx: 'connection',
                    cid: connection.id,
                    action: 'available'
                }, 'Connection #%s became available', connection.id);

                if (_this5._closed) {
                    // if already closed run close() that will remove this connections from connections list
                    _this5.close();
                } else {
                    // check if there's anything else to send
                    _this5._processMessages();
                }
            });

            // resource is terminated with an error
            connection.once('error', function (err) {
                if (err.code !== 'EMAXLIMIT') {
                    _this5.logger.error({
                        err: err,
                        tnx: 'pool',
                        cid: connection.id
                    }, 'Pool Error for #%s: %s', connection.id, err.message);
                } else {
                    _this5.logger.debug({
                        tnx: 'pool',
                        cid: connection.id,
                        action: 'maxlimit'
                    }, 'Max messages limit exchausted for #%s', connection.id);
                }

                if (connection.queueEntry) {
                    try {
                        connection.queueEntry.callback(err);
                    } catch (E) {
                        _this5.logger.error({
                            err: E,
                            tnx: 'callback',
                            cid: connection.id
                        }, 'Callback error for #%s: %s', connection.id, E.message);
                    }
                    connection.queueEntry = false;
                }

                // remove the erroneus connection from connections list
                _this5._removeConnection(connection);

                _this5._continueProcessing();
            });

            connection.once('close', function () {
                _this5.logger.info({
                    tnx: 'connection',
                    cid: connection.id,
                    action: 'closed'
                }, 'Connection #%s was closed', connection.id);

                _this5._removeConnection(connection);

                if (connection.queueEntry) {
                    // If the connection closed when sending, add the message to the queue again
                    // Note that we must wait a bit.. because the callback of the 'error' handler might be called
                    // in the next event loop
                    setTimeout(function () {
                        if (connection.queueEntry) {
                            _this5.logger.debug({
                                tnx: 'pool',
                                cid: connection.id,
                                messageId: connection.queueEntry.messageId,
                                action: 'requeue'
                            }, 'Re-queued message <%s> for #%s', connection.queueEntry.messageId, connection.id);
                            _this5._queue.unshift(connection.queueEntry);
                            connection.queueEntry = false;
                        }
                        _this5._continueProcessing();
                    }, 50);
                } else {
                    _this5._continueProcessing();
                }
            });

            this._connections.push(connection);

            return connection;
        }

        /**
         * Continue to process message if the pool hasn't closed
         */

    }, {
        key: '_continueProcessing',
        value: function _continueProcessing() {
            var _this6 = this;

            if (this._closed) {
                this.close();
            } else {
                setTimeout(function () {
                    return _this6._processMessages();
                }, 100);
            }
        }

        /**
         * Remove resource from pool
         *
         * @param {Object} connection The PoolResource to remove
         */

    }, {
        key: '_removeConnection',
        value: function _removeConnection(connection) {
            var index = this._connections.indexOf(connection);

            if (index !== -1) {
                this._connections.splice(index, 1);
            }
        }

        /**
         * Checks if connections have hit current rate limit and if so, queues the availability callback
         *
         * @param {Function} callback Callback function to run once rate limiter has been cleared
         */

    }, {
        key: '_checkRateLimit',
        value: function _checkRateLimit(callback) {
            var _this7 = this;

            if (!this._rateLimit.limit) {
                return callback();
            }

            var now = Date.now();

            if (this._rateLimit.counter < this._rateLimit.limit) {
                return callback();
            }

            this._rateLimit.waiting.push(callback);

            if (this._rateLimit.checkpoint <= now - this._rateLimit.delta) {
                return this._clearRateLimit();
            } else if (!this._rateLimit.timeout) {
                this._rateLimit.timeout = setTimeout(function () {
                    return _this7._clearRateLimit();
                }, this._rateLimit.delta - (now - this._rateLimit.checkpoint));
                this._rateLimit.checkpoint = now;
            }
        }

        /**
         * Clears current rate limit limitation and runs paused callback
         */

    }, {
        key: '_clearRateLimit',
        value: function _clearRateLimit() {
            clearTimeout(this._rateLimit.timeout);
            this._rateLimit.timeout = null;
            this._rateLimit.counter = 0;
            this._rateLimit.checkpoint = false;

            // resume all paused connections
            while (this._rateLimit.waiting.length) {
                var cb = this._rateLimit.waiting.shift();
                setImmediate(cb);
            }
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
         * Verifies SMTP configuration
         *
         * @param {Function} callback Callback function
         */

    }, {
        key: 'verify',
        value: function verify(callback) {
            var _this8 = this;

            var promise = void 0;

            if (!callback && typeof Promise === 'function') {
                promise = new Promise(function (resolve, reject) {
                    callback = shared.callbackPromise(resolve, reject);
                });
            }

            var auth = new PoolResource(this).auth;

            this.getSocket(this.options, function (err, socketOptions) {
                if (err) {
                    return callback(err);
                }

                var options = _this8.options;
                if (socketOptions && socketOptions.connection) {
                    _this8.logger.info({
                        tnx: 'proxy',
                        remoteAddress: socketOptions.connection.remoteAddress,
                        remotePort: socketOptions.connection.remotePort,
                        destHost: options.host || '',
                        destPort: options.port || '',
                        action: 'connected'
                    }, 'Using proxied socket from %s:%s to %s:%s', socketOptions.connection.remoteAddress, socketOptions.connection.remotePort, options.host || '', options.port || '');
                    options = shared.assign(false, options);
                    Object.keys(socketOptions).forEach(function (key) {
                        options[key] = socketOptions[key];
                    });
                }

                var connection = new SMTPConnection(options);
                var returned = false;

                connection.once('error', function (err) {
                    if (returned) {
                        return;
                    }
                    returned = true;
                    connection.close();
                    return callback(err);
                });

                connection.once('end', function () {
                    if (returned) {
                        return;
                    }
                    returned = true;
                    return callback(new Error('Connection closed'));
                });

                var finalize = function finalize() {
                    if (returned) {
                        return;
                    }
                    returned = true;
                    connection.quit();
                    return callback(null, true);
                };

                connection.connect(function () {
                    if (returned) {
                        return;
                    }

                    if (auth) {
                        connection.login(auth, function (err) {
                            if (returned) {
                                return;
                            }

                            if (err) {
                                returned = true;
                                connection.close();
                                return callback(err);
                            }

                            finalize();
                        });
                    } else {
                        finalize();
                    }
                });
            });

            return promise;
        }
    }]);

    return SMTPPool;
}(EventEmitter);

// expose to the world


module.exports = SMTPPool;
