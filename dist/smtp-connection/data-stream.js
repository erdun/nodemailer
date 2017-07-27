'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var stream = require('stream');
var Transform = stream.Transform;

/**
 * Escapes dots in the beginning of lines. Ends the stream with <CR><LF>.<CR><LF>
 * Also makes sure that only <CR><LF> sequences are used for linebreaks
 *
 * @param {Object} options Stream options
 */

var DataStream = function (_Transform) {
    _inherits(DataStream, _Transform);

    function DataStream(options) {
        _classCallCheck(this, DataStream);

        // init Transform
        var _this = _possibleConstructorReturn(this, (DataStream.__proto__ || Object.getPrototypeOf(DataStream)).call(this, options));

        _this.options = options || {};
        _this._curLine = '';

        _this.inByteCount = 0;
        _this.outByteCount = 0;
        _this.lastByte = false;

        return _this;
    }

    /**
     * Escapes dots
     */


    _createClass(DataStream, [{
        key: '_transform',
        value: function _transform(chunk, encoding, done) {
            var chunks = [];
            var chunklen = 0;
            var i = void 0,
                len = void 0,
                lastPos = 0;
            var buf = void 0;

            if (!chunk || !chunk.length) {
                return done();
            }

            if (typeof chunk === 'string') {
                chunk = new Buffer(chunk);
            }

            this.inByteCount += chunk.length;

            for (i = 0, len = chunk.length; i < len; i++) {
                if (chunk[i] === 0x2E) {
                    // .
                    if (i && chunk[i - 1] === 0x0A || !i && (!this.lastByte || this.lastByte === 0x0A)) {
                        buf = chunk.slice(lastPos, i + 1);
                        chunks.push(buf);
                        chunks.push(new Buffer('.'));
                        chunklen += buf.length + 1;
                        lastPos = i + 1;
                    }
                } else if (chunk[i] === 0x0A) {
                    // .
                    if (i && chunk[i - 1] !== 0x0D || !i && this.lastByte !== 0x0D) {
                        if (i > lastPos) {
                            buf = chunk.slice(lastPos, i);
                            chunks.push(buf);
                            chunklen += buf.length + 2;
                        } else {
                            chunklen += 2;
                        }
                        chunks.push(new Buffer('\r\n'));
                        lastPos = i + 1;
                    }
                }
            }

            if (chunklen) {
                // add last piece
                if (lastPos < chunk.length) {
                    buf = chunk.slice(lastPos);
                    chunks.push(buf);
                    chunklen += buf.length;
                }

                this.outByteCount += chunklen;
                this.push(Buffer.concat(chunks, chunklen));
            } else {
                this.outByteCount += chunk.length;
                this.push(chunk);
            }

            this.lastByte = chunk[chunk.length - 1];
            done();
        }

        /**
         * Finalizes the stream with a dot on a single line
         */

    }, {
        key: '_flush',
        value: function _flush(done) {
            var buf = void 0;
            if (this.lastByte === 0x0A) {
                buf = new Buffer('.\r\n');
            } else if (this.lastByte === 0x0D) {
                buf = new Buffer('\n.\r\n');
            } else {
                buf = new Buffer('\r\n.\r\n');
            }
            this.outByteCount += buf.length;
            this.push(buf);
            done();
        }
    }]);

    return DataStream;
}(Transform);

module.exports = DataStream;
