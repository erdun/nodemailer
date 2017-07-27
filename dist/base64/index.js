'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Transform = require('stream').Transform;

/**
 * Encodes a Buffer into a base64 encoded string
 *
 * @param {Buffer} buffer Buffer to convert
 * @returns {String} base64 encoded string
 */
function encode(buffer) {
    if (typeof buffer === 'string') {
        buffer = new Buffer(buffer, 'utf-8');
    }

    return buffer.toString('base64');
}

/**
 * Adds soft line breaks to a base64 string
 *
 * @param {String} str base64 encoded string that might need line wrapping
 * @param {Number} [lineLength=76] Maximum allowed length for a line
 * @returns {String} Soft-wrapped base64 encoded string
 */
function wrap(str, lineLength) {
    str = (str || '').toString();
    lineLength = lineLength || 76;

    if (str.length <= lineLength) {
        return str;
    }

    var result = [];
    var pos = 0;
    var chunkLength = lineLength * 1024;
    while (pos < str.length) {
        var wrappedLines = str.substr(pos, chunkLength).replace(new RegExp('.{' + lineLength + '}', 'g'), '$&\r\n').trim();
        result.push(wrappedLines);
        pos += chunkLength;
    }

    return result.join('\r\n').trim();
}

/**
 * Creates a transform stream for encoding data to base64 encoding
 *
 * @constructor
 * @param {Object} options Stream options
 * @param {Number} [options.lineLength=76] Maximum lenght for lines, set to false to disable wrapping
 */

var Encoder = function (_Transform) {
    _inherits(Encoder, _Transform);

    function Encoder(options) {
        _classCallCheck(this, Encoder);

        // init Transform
        var _this = _possibleConstructorReturn(this, (Encoder.__proto__ || Object.getPrototypeOf(Encoder)).call(this));

        _this.options = options || {};

        if (_this.options.lineLength !== false) {
            _this.options.lineLength = _this.options.lineLength || 76;
        }

        _this._curLine = '';
        _this._remainingBytes = false;

        _this.inputBytes = 0;
        _this.outputBytes = 0;
        return _this;
    }

    _createClass(Encoder, [{
        key: '_transform',
        value: function _transform(chunk, encoding, done) {
            var _this2 = this;

            var b64 = void 0;

            if (encoding !== 'buffer') {
                chunk = new Buffer(chunk, encoding);
            }

            if (!chunk || !chunk.length) {
                return done();
            }

            this.inputBytes += chunk.length;

            if (this._remainingBytes && this._remainingBytes.length) {
                chunk = Buffer.concat([this._remainingBytes, chunk]);
                this._remainingBytes = false;
            }

            if (chunk.length % 3) {
                this._remainingBytes = chunk.slice(chunk.length - chunk.length % 3);
                chunk = chunk.slice(0, chunk.length - chunk.length % 3);
            } else {
                this._remainingBytes = false;
            }

            b64 = this._curLine + encode(chunk);

            if (this.options.lineLength) {
                b64 = wrap(b64, this.options.lineLength);
                b64 = b64.replace(/(^|\n)([^\n]*)$/, function (match, lineBreak, lastLine) {
                    _this2._curLine = lastLine;
                    return lineBreak;
                });
            }

            if (b64) {
                this.outputBytes += b64.length;
                this.push(b64);
            }

            done();
        }
    }, {
        key: '_flush',
        value: function _flush(done) {
            if (this._remainingBytes && this._remainingBytes.length) {
                this._curLine += encode(this._remainingBytes);
            }

            if (this._curLine) {
                this._curLine = wrap(this._curLine, this.options.lineLength);
                this.outputBytes += this._curLine.length;
                this.push(this._curLine, 'ascii');
                this._curLine = '';
            }
            done();
        }
    }]);

    return Encoder;
}(Transform);

// expose to the world


module.exports = {
    encode: encode,
    wrap: wrap,
    Encoder: Encoder
};
