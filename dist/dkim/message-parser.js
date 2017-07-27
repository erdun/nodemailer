'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Transform = require('stream').Transform;

/**
 * MessageParser instance is a transform stream that separates message headers
 * from the rest of the body. Headers are emitted with the 'headers' event. Message
 * body is passed on as the resulting stream.
 */

var MessageParser = function (_Transform) {
    _inherits(MessageParser, _Transform);

    function MessageParser(options) {
        _classCallCheck(this, MessageParser);

        var _this = _possibleConstructorReturn(this, (MessageParser.__proto__ || Object.getPrototypeOf(MessageParser)).call(this, options));

        _this.lastBytes = Buffer.alloc(4);
        _this.headersParsed = false;
        _this.headerBytes = 0;
        _this.headerChunks = [];
        _this.rawHeaders = false;
        _this.bodySize = 0;
        return _this;
    }

    /**
     * Keeps count of the last 4 bytes in order to detect line breaks on chunk boundaries
     *
     * @param {Buffer} data Next data chunk from the stream
     */


    _createClass(MessageParser, [{
        key: 'updateLastBytes',
        value: function updateLastBytes(data) {
            var lblen = this.lastBytes.length;
            var nblen = Math.min(data.length, lblen);

            // shift existing bytes
            for (var i = 0, len = lblen - nblen; i < len; i++) {
                this.lastBytes[i] = this.lastBytes[i + nblen];
            }

            // add new bytes
            for (var _i = 1; _i <= nblen; _i++) {
                this.lastBytes[lblen - _i] = data[data.length - _i];
            }
        }

        /**
         * Finds and removes message headers from the remaining body. We want to keep
         * headers separated until final delivery to be able to modify these
         *
         * @param {Buffer} data Next chunk of data
         * @return {Boolean} Returns true if headers are already found or false otherwise
         */

    }, {
        key: 'checkHeaders',
        value: function checkHeaders(data) {
            var _this2 = this;

            if (this.headersParsed) {
                return true;
            }

            var lblen = this.lastBytes.length;
            var headerPos = 0;
            this.curLinePos = 0;
            for (var i = 0, len = this.lastBytes.length + data.length; i < len; i++) {
                var chr = void 0;
                if (i < lblen) {
                    chr = this.lastBytes[i];
                } else {
                    chr = data[i - lblen];
                }
                if (chr === 0x0A && i) {
                    var pr1 = i - 1 < lblen ? this.lastBytes[i - 1] : data[i - 1 - lblen];
                    var pr2 = i > 1 ? i - 2 < lblen ? this.lastBytes[i - 2] : data[i - 2 - lblen] : false;
                    if (pr1 === 0x0A) {
                        this.headersParsed = true;
                        headerPos = i - lblen + 1;
                        this.headerBytes += headerPos;
                        break;
                    } else if (pr1 === 0x0D && pr2 === 0x0A) {
                        this.headersParsed = true;
                        headerPos = i - lblen + 1;
                        this.headerBytes += headerPos;
                        break;
                    }
                }
            }

            if (this.headersParsed) {
                this.headerChunks.push(data.slice(0, headerPos));
                this.rawHeaders = Buffer.concat(this.headerChunks, this.headerBytes);
                this.headerChunks = null;
                this.emit('headers', this.parseHeaders());
                if (data.length - 1 > headerPos) {
                    var chunk = data.slice(headerPos);
                    this.bodySize += chunk.length;
                    // this would be the first chunk of data sent downstream
                    setImmediate(function () {
                        return _this2.push(chunk);
                    });
                }
                return false;
            } else {
                this.headerBytes += data.length;
                this.headerChunks.push(data);
            }

            // store last 4 bytes to catch header break
            this.updateLastBytes(data);

            return false;
        }
    }, {
        key: '_transform',
        value: function _transform(chunk, encoding, callback) {
            if (!chunk || !chunk.length) {
                return callback();
            }

            if (typeof chunk === 'string') {
                chunk = new Buffer(chunk, encoding);
            }

            var headersFound = void 0;

            try {
                headersFound = this.checkHeaders(chunk);
            } catch (E) {
                return callback(E);
            }

            if (headersFound) {
                this.bodySize += chunk.length;
                this.push(chunk);
            }

            setImmediate(callback);
        }
    }, {
        key: '_flush',
        value: function _flush(callback) {
            if (this.headerChunks) {
                var chunk = Buffer.concat(this.headerChunks, this.headerBytes);
                this.bodySize += chunk.length;
                this.push(chunk);
                this.headerChunks = null;
            }
            callback();
        }
    }, {
        key: 'parseHeaders',
        value: function parseHeaders() {
            var lines = (this.rawHeaders || '').toString().split(/\r?\n/);
            for (var i = lines.length - 1; i > 0; i--) {
                if (/^\s/.test(lines[i])) {
                    lines[i - 1] += '\n' + lines[i];
                    lines.splice(i, 1);
                }
            }
            return lines.filter(function (line) {
                return line.trim();
            }).map(function (line) {
                return {
                    key: line.substr(0, line.indexOf(':')).trim().toLowerCase(),
                    line: line
                };
            });
        }
    }]);

    return MessageParser;
}(Transform);

module.exports = MessageParser;
