'use strict';

// streams through a message body and calculates relaxed body hash

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Transform = require('stream').Transform;
var crypto = require('crypto');

var RelaxedBody = function (_Transform) {
    _inherits(RelaxedBody, _Transform);

    function RelaxedBody(options) {
        _classCallCheck(this, RelaxedBody);

        var _this = _possibleConstructorReturn(this, (RelaxedBody.__proto__ || Object.getPrototypeOf(RelaxedBody)).call(this));

        options = options || {};
        _this.chunkBuffer = [];
        _this.chunkBufferLen = 0;
        _this.bodyHash = crypto.createHash(options.hashAlgo || 'sha1');
        _this.remainder = '';
        _this.byteLength = 0;

        _this.debug = options.debug;
        _this._debugBody = options.debug ? [] : false;
        return _this;
    }

    _createClass(RelaxedBody, [{
        key: 'updateHash',
        value: function updateHash(chunk) {
            var bodyStr = void 0;

            // find next remainder
            var nextRemainder = '';

            // This crux finds and removes the spaces from the last line and the newline characters after the last non-empty line
            // If we get another chunk that does not match this description then we can restore the previously processed data
            var state = 'file';
            for (var i = chunk.length - 1; i >= 0; i--) {
                var c = chunk[i];

                if (state === 'file' && (c === 0x0A || c === 0x0D)) {
                    // do nothing, found \n or \r at the end of chunk, stil end of file
                } else if (state === 'file' && (c === 0x09 || c === 0x20)) {
                    // switch to line ending mode, this is the last non-empty line
                    state = 'line';
                } else if (state === 'line' && (c === 0x09 || c === 0x20)) {
                    // do nothing, found ' ' or \t at the end of line, keep processing the last non-empty line
                } else if (state === 'file' || state === 'line') {
                    // non line/file ending character found, switch to body mode
                    state = 'body';
                    if (i === chunk.length - 1) {
                        // final char is not part of line end or file end, so do nothing
                        break;
                    }
                }

                if (i === 0) {
                    // reached to the beginning of the chunk, check if it is still about the ending
                    // and if the remainder also matches
                    if (state === 'file' && (!this.remainder || /[\r\n]$/.test(this.remainder)) || state === 'line' && (!this.remainder || /[ \t]$/.test(this.remainder))) {
                        // keep everything
                        this.remainder += chunk.toString('binary');
                        return;
                    } else if (state === 'line' || state === 'file') {
                        // process existing remainder as normal line but store the current chunk
                        nextRemainder = chunk.toString('binary');
                        chunk = false;
                        break;
                    }
                }

                if (state !== 'body') {
                    continue;
                }

                // reached first non ending byte
                nextRemainder = chunk.slice(i + 1).toString('binary');
                chunk = chunk.slice(0, i + 1);
                break;
            }

            var needsFixing = !!this.remainder;
            if (chunk && !needsFixing) {
                // check if we even need to change anything
                for (var _i = 0, len = chunk.length; _i < len; _i++) {
                    if (_i && chunk[_i] === 0x0A && chunk[_i - 1] !== 0x0D) {
                        // missing \r before \n
                        needsFixing = true;
                        break;
                    } else if (_i && chunk[_i] === 0x0D && chunk[_i - 1] === 0x20) {
                        // trailing WSP found
                        needsFixing = true;
                        break;
                    } else if (_i && chunk[_i] === 0x20 && chunk[_i - 1] === 0x20) {
                        // multiple spaces found, needs to be replaced with just one
                        needsFixing = true;
                        break;
                    } else if (chunk[_i] === 0x09) {
                        // TAB found, needs to be replaced with a space
                        needsFixing = true;
                        break;
                    }
                }
            }

            if (needsFixing) {
                bodyStr = this.remainder + (chunk ? chunk.toString('binary') : '');
                this.remainder = nextRemainder;
                bodyStr = bodyStr.replace(/\r?\n/g, '\n') // use js line endings
                .replace(/[ \t]*$/mg, '') // remove line endings, rtrim
                .replace(/[ \t]+/mg, ' ') // single spaces
                .replace(/\n/g, '\r\n'); // restore rfc822 line endings
                chunk = Buffer.from(bodyStr, 'binary');
            } else if (nextRemainder) {
                this.remainder = nextRemainder;
            }

            if (this.debug) {
                this._debugBody.push(chunk);
            }
            this.bodyHash.update(chunk);
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

            this.updateHash(chunk);

            this.byteLength += chunk.length;
            this.push(chunk);

            callback();
        }
    }, {
        key: '_flush',
        value: function _flush(callback) {
            // generate final hash and emit it
            if (/[\r\n]$/.test(this.remainder) && this.byteLength > 2) {
                // add terminating line end
                this.bodyHash.update(Buffer.from('\r\n'));
            }
            if (!this.byteLength) {
                // emit empty line buffer to keep the stream flowing
                this.push(Buffer.from('\r\n'));
                // this.bodyHash.update(Buffer.from('\r\n'));
            }
            this.emit('hash', this.bodyHash.digest('base64'), this.debug ? Buffer.concat(this._debugBody) : false);
            callback();
        }
    }]);

    return RelaxedBody;
}(Transform);

module.exports = RelaxedBody;
