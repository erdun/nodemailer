'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var shared = require('../shared');
var MimeNode = require('../mime-node');

var MailMessage = function () {
    function MailMessage(mailer, data) {
        var _this = this;

        _classCallCheck(this, MailMessage);

        this.mailer = mailer;
        this.data = {};
        this.message = null;

        data = data || {};
        var options = mailer.options || {};
        var defaults = mailer._defaults || {};

        Object.keys(data).forEach(function (key) {
            _this.data[key] = data[key];
        });

        this.data.headers = this.data.headers || {};

        // apply defaults
        Object.keys(defaults).forEach(function (key) {
            if (!(key in _this.data)) {
                _this.data[key] = defaults[key];
            } else if (key === 'headers') {
                // headers is a special case. Allow setting individual default headers
                Object.keys(defaults.headers).forEach(function (key) {
                    if (!(key in _this.data.headers)) {
                        _this.data.headers[key] = defaults.headers[key];
                    }
                });
            }
        });

        // force specific keys from transporter options
        ['disableFileAccess', 'disableUrlAccess'].forEach(function (key) {
            if (key in options) {
                _this.data[key] = options[key];
            }
        });
    }

    _createClass(MailMessage, [{
        key: 'resolveContent',
        value: function resolveContent() {
            return shared.resolveContent.apply(shared, arguments);
        }
    }, {
        key: 'resolveAll',
        value: function resolveAll(callback) {
            var _this2 = this;

            var keys = [[this.data, 'html'], [this.data, 'text'], [this.data, 'watchHtml'], [this.data, 'icalEvent']];

            if (this.data.alternatives && this.data.alternatives.length) {
                this.data.alternatives.forEach(function (alternative, i) {
                    keys.push([_this2.data.alternatives, i]);
                });
            }

            if (this.data.attachments && this.data.attachments.length) {
                this.data.attachments.forEach(function (alternative, i) {
                    keys.push([_this2.data.attachments, i]);
                });
            }

            var mimeNode = new MimeNode();

            var addressKeys = ['from', 'to', 'cc', 'bcc', 'sender', 'replyTo'];

            addressKeys.forEach(function (address) {
                var value = void 0;
                if (_this2.message) {
                    value = [].concat(mimeNode._parseAddresses(_this2.message.getHeader(address === 'replyTo' ? 'reply-to' : address)) || []);
                } else if (_this2.data[address]) {
                    value = [].concat(mimeNode._parseAddresses(_this2.data[address]) || []);
                }
                if (value && value.length) {
                    _this2.data[address] = value;
                } else if (address in _this2.data) {
                    _this2.data[address] = null;
                }
            });

            var singleKeys = ['from', 'sender', 'replyTo'];
            singleKeys.forEach(function (address) {
                if (_this2.data[address]) {
                    _this2.data[address] = _this2.data[address].shift();
                }
            });

            var pos = 0;
            var resolveNext = function resolveNext() {
                if (pos >= keys.length) {
                    return callback(null, _this2.data);
                }
                var args = keys[pos++];
                if (!args[0] || !args[0][args[1]]) {
                    return resolveNext();
                }
                shared.resolveContent.apply(shared, _toConsumableArray(args).concat([function (err, value) {
                    if (err) {
                        return callback(err);
                    }

                    var node = {
                        content: value
                    };
                    if (args[0][args[1]] && _typeof(args[0][args[1]]) === 'object' && !Buffer.isBuffer(args[0][args[1]])) {
                        Object.keys(args[0][args[1]]).forEach(function (key) {
                            if (!(key in node) && !['content', 'path', 'href', 'raw'].includes(key)) {
                                node[key] = args[0][args[1]][key];
                            }
                        });
                    }

                    args[0][args[1]] = node;
                    resolveNext();
                }]));
            };

            setImmediate(function () {
                return resolveNext();
            });
        }
    }, {
        key: 'setMailerHeader',
        value: function setMailerHeader() {
            if (!this.message || !this.data.xMailer) {
                return;
            }
            this.message.setHeader('X-Mailer', this.data.xMailer);
        }
    }, {
        key: 'setPriorityHeaders',
        value: function setPriorityHeaders() {
            if (!this.message || !this.data.priority) {
                return;
            }
            switch ((this.data.priority || '').toString().toLowerCase()) {
                case 'high':
                    this.message.setHeader('X-Priority', '1 (Highest)');
                    this.message.setHeader('X-MSMail-Priority', 'High');
                    this.message.setHeader('Importance', 'High');
                    break;
                case 'low':
                    this.message.setHeader('X-Priority', '5 (Lowest)');
                    this.message.setHeader('X-MSMail-Priority', 'Low');
                    this.message.setHeader('Importance', 'Low');
                    break;
                default:
                // do not add anything, since all messages are 'Normal' by default
            }
        }
    }, {
        key: 'setListHeaders',
        value: function setListHeaders() {
            var _this3 = this;

            if (!this.message || !this.data.list || _typeof(this.data.list) !== 'object') {
                return;
            }
            // add optional List-* headers
            if (this.data.list && _typeof(this.data.list) === 'object') {
                this._getListHeaders(this.data.list).forEach(function (listHeader) {
                    listHeader.value.forEach(function (value) {
                        _this3.message.addHeader(listHeader.key, value);
                    });
                });
            }
        }
    }, {
        key: '_getListHeaders',
        value: function _getListHeaders(listData) {
            var _this4 = this;

            // make sure an url looks like <protocol:url>
            return Object.keys(listData).map(function (key) {
                return {
                    key: 'list-' + key.toLowerCase().trim(),
                    value: [].concat(listData[key] || []).map(function (value) {
                        if (typeof value === 'string') {
                            return _this4._formatListUrl(value);
                        }
                        return {
                            prepared: true,
                            value: [].concat(value || []).map(function (value) {
                                if (typeof value === 'string') {
                                    return _this4._formatListUrl(value);
                                }
                                if (value && value.url) {
                                    return _this4._formatListUrl(value.url) + (value.comment ? ' (' + value.comment + ')' : '');
                                }
                                return '';
                            }).join(', ')
                        };
                    })
                };
            });
        }
    }, {
        key: '_formatListUrl',
        value: function _formatListUrl(url) {
            url = url.replace(/[\s<]+|[\s>]+/g, '');
            if (/^(https?|mailto|ftp):/.test(url)) {
                return '<' + url + '>';
            }
            if (/^[^@]+@[^@]+$/.test(url)) {
                return '<mailto:' + url + '>';
            }

            return '<http://' + url + '>';
        }
    }]);

    return MailMessage;
}();

module.exports = MailMessage;
